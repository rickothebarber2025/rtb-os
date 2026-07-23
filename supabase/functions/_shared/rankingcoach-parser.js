// Parses rankingCoach's "Great news! Your business reputation is growing"
// review-alert emails. rankingCoach is a third-party monitoring service
// Ricko is already subscribed to; these emails relay individual Google
// Business Profile reviews (reviewer name, source, star rating, and
// review text when the reviewer left one -- some reviews are rating-only
// with no written text, which is a real, valid case, not a parsing gap).
//
// Confirmed against two real examples before writing this:
//   1. "Momo Fu" / Good / 5.0 / (no review text shown)
//   2. "Little Him" / Good / 5.0 / "Really Nice"

export const RANKINGCOACH_PARSER_VERSION = "rankingcoach-review-email-v1";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeBody(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeIsoMillis(value) {
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const parsed = new Date(number);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Matches the "You've just scored a star review on Google" block and
// pulls out reviewer name, star rating, and review text (if present).
// Structure, line by line after that header:
//   <reviewer name>
//   From Google Business Profile
//   <sentiment label, e.g. "Good">   (structural -- not part of the review)
//   <rating, e.g. "5.0">             (structural)
//   <star glyphs, e.g. "★★★★★">      (structural, redundant with the rating)
//   <review text, if the reviewer left one -- can span multiple lines>
//   View all reviews                  (button -- marks the end of this block)
//
// Deliberately line-based rather than a blanket regex-strip: an
// earlier version stripped any occurrence of words like "great" or
// digits 1-5 anywhere in the block, which corrupted real review text
// containing those same words naturally (e.g. "This was a great
// experience, 5 stars for sure!" lost both "great" and "5"). Each
// structural line is consumed at most once, in order; everything
// else is left completely untouched as the verbatim review text.
function parseReviewBlock(body) {
  const headerPattern = /you'?ve just scored a star review on google/i;
  const headerMatch = body.match(headerPattern);
  if (!headerMatch) return null;

  const afterHeader = body.slice(headerMatch.index + headerMatch[0].length);
  const sourceMarker = /from google business profile/i;
  const sourceMatch = afterHeader.match(sourceMarker);
  if (!sourceMatch) return null;

  const reviewerName = clean(afterHeader.slice(0, sourceMatch.index));
  const afterSource = afterHeader.slice(sourceMatch.index + sourceMatch[0].length);

  // End the block at the "View all reviews" button, or end of body.
  const endMatch = afterSource.match(/view all reviews/i);
  const block = endMatch ? afterSource.slice(0, endMatch.index) : afterSource;

  const lines = block.split("\n").map((line) => clean(line)).filter(Boolean);

  let rating = null;
  const reviewTextLines = [];
  let consumedSentiment = false;
  let consumedRating = false;
  let consumedStars = false;

  for (const line of lines) {
    if (!consumedSentiment && /^(excellent|great|good|fair|poor|bad)$/i.test(line)) {
      consumedSentiment = true;
      continue;
    }
    if (!consumedRating && /^[1-5](?:\.\d)?$/.test(line)) {
      rating = Math.round(Number(line));
      consumedRating = true;
      continue;
    }
    if (!consumedStars && /^[★☆]+$/.test(line)) {
      consumedStars = true;
      continue;
    }
    reviewTextLines.push(line);
  }

  return { rating, reviewerName, reviewText: clean(reviewTextLines.join(" ")) };
}

export function parseRankingCoachEmail({
  body = "",
  headers = {},
  internalDate = null,
  messageId = "",
  subject = "",
  threadId = "",
} = {}) {
  const normalizedBody = normalizeBody(body);
  const parsed = parseReviewBlock(normalizedBody);
  const sourceTimestamp =
    safeIsoDate(headers.date) || safeIsoMillis(internalDate) || new Date().toISOString();

  if (!parsed) {
    return {
      events: [],
      parserVersion: RANKINGCOACH_PARSER_VERSION,
      templateName: "unrecognized",
      unknown: true,
    };
  }

  const event = {
    appointmentEndAt: null,
    appointmentStartAt: null,
    bookingIdentifier: "",
    clientEmail: "",
    clientName: parsed.reviewerName,
    clientPhone: "",
    eventType: "new_review",
    location: "",
    parserTemplate: "rankingcoach-google-review",
    parserVersion: RANKINGCOACH_PARSER_VERSION,
    price: null,
    publishedAt: sourceTimestamp,
    rating: parsed.rating,
    reviewerName: parsed.reviewerName,
    reviewText: parsed.reviewText,
    reviewUrl: "",
    serviceName: "",
    sourceEventId: `${messageId}:new_review`,
    sourceMessageId: messageId,
    sourceThreadId: threadId,
    sourceTimestamp,
    staffEmail: "",
    staffName: "",
    raw: {
      body: normalizedBody.slice(0, 12000),
      headers,
      subject,
      template: "rankingcoach-google-review",
    },
  };

  return {
    events: [event],
    parserVersion: RANKINGCOACH_PARSER_VERSION,
    templateName: "rankingcoach-google-review",
    unknown: false,
  };
}
