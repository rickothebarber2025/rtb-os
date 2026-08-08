export const BOOKSY_PARSER_VERSION = "booksy-email-v2";

// Booksy's real notification emails are NOT a labeled key/value format - they're a
// fixed narrative layout, e.g.:
//
//   Kevin GT: new booking
//
//   Kevin GT
//   (613) 276-6593
//    mailto:kevance123@gmail.com - kevance123@gmail.com
//   Friday, July 17, 2026, 5:55 p.m. - 6:45 p.m.
//   \tBARBER SERVICES: RTB SIGNATURE HAIRCUT + BEARD
//   $50.00,
//   5:55 p.m. - 6:45 p.m.
//   with
//   RICKO | BARBER
//   A note from the customer: (optional)
//   ...
//   A note from the business:
//   RTB Appointment Policy (or straight into the policy text)
//   ...boilerplate cancellation policy paragraph...
//
// Every single email - regardless of type - includes that boilerplate policy
// paragraph near the bottom, and it contains the word "rescheduled" ("...may be
// treated as a walk-in or rescheduled...", "appointment rescheduling"). The old
// parser scanned the whole body for keywords, so nearly every "new booking" email
// was misclassified as a reschedule because of that boilerplate text, and a
// generic "business:" label regex was grabbing the boilerplate's own title
// ("RTB Appointment Policy") and storing it as if it were a location.
//
// The subject line is clean and reliable, so event type is now detected from the
// subject first. Field extraction (client name/phone/email, date/time, service,
// price, staff) is anchored to the fixed narrative layout above rather than
// generic "Label: value" patterns, which never actually appear in these emails.

const SUBJECT_RULES = [
  {
    eventType: "appointment_rescheduled",
    name: "appointment-rescheduled-by-client",
    pattern: /:\s*changed his\/her booking/i,
  },
  {
    eventType: "appointment_created",
    name: "new-booking",
    pattern: /:\s*new booking\b/i,
  },
  {
    eventType: "appointment_rescheduled",
    name: "appointment-rescheduled-by-staff",
    pattern: /^changed appointment on:/i,
  },
  {
    eventType: "appointment_updated",
    name: "reschedule-confirmed",
    pattern: /confirmed the new appointment time proposed/i,
  },
  {
    eventType: "appointment_cancelled",
    name: "appointment-cancelled",
    pattern: /cancelled appointment on:/i,
  },
  {
    eventType: "new_review",
    name: "new-review",
    pattern: /new review|left.+review|rated.+stars?|customer feedback/i,
  },
  {
    eventType: "client_created",
    name: "client-created",
    pattern: /new client|client.+created|customer.+created/i,
  },
  {
    eventType: "time_off_activity",
    name: "time-off",
    pattern: /time off|day off|vacation/i,
  },
  {
    eventType: "schedule_activity",
    name: "schedule-activity",
    pattern: /schedule|availability|working hours/i,
  },
];

// Kept as a fallback for any email shape not covered by SUBJECT_RULES above.
const EVENT_TEMPLATES = [
  {
    eventType: "appointment_cancelled",
    name: "appointment-cancelled",
    patterns: [/cancel(l)?ed/i, /appointment.+cancel/i],
  },
  {
    eventType: "appointment_created",
    name: "appointment-created",
    patterns: [/new appointment/i, /appointment.+created/i, /new booking/i, /booked.+appointment/i],
  },
  {
    eventType: "appointment_rescheduled",
    name: "appointment-rescheduled",
    // Confirmed via real data: every Booksy email (including plain "new
    // booking" ones) includes generic policy-footer text containing the
    // word "rescheduled" ("...or rescheduled based on availability"),
    // which was matching this template before appointment_created ever
    // got a chance to -- misclassifying 20 of 24 real events, all of
    // which were actually new bookings. appointment_created is checked
    // first above specifically to prevent that footer text from winning.
    patterns: [/rescheduled/i, /appointment.+moved/i, /changed.+time/i],
  },
  {
    eventType: "appointment_updated",
    name: "appointment-updated",
    patterns: [
      /appointment.+updated/i,
      /booking.+updated/i,
      /appointment.+changed/i,
      /confirmed the new appointment time/i,
    ],
  },
  {
    eventType: "client_created",
    name: "client-created",
    patterns: [/new client/i, /client.+created/i, /customer.+created/i],
  },
  {
    eventType: "time_off_activity",
    name: "time-off",
    patterns: [/time off/i, /day off/i, /vacation/i],
  },
  {
    eventType: "schedule_activity",
    name: "schedule-activity",
    patterns: [/schedule/i, /availability/i, /working hours/i],
  },
  {
    eventType: "new_review",
    name: "new-review",
    patterns: [/new review/i, /left.+review/i, /rated.+stars?/i, /customer feedback/i],
  },
];

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeBody(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textForMatching(subject, body) {
  return `${subject || ""}\n${body || ""}`;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function parseMoney(value) {
  const number = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function safeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeIsoMillis(value) {
  if (!value) return null;
  const parsed = new Date(Number(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// A regex match here is a candidate, not a certainty -- reject
// anything that rounds outside the real 1-5 star range rather than
// clamping it into range. Clamping a stray "5.9" (almost certainly a
// coincidental match on unrelated numeric text near the word "rated"
// or "stars", not a genuine rating) down to 5 would record a rating
// that was never actually there. This was a real, confirmed bug:
// activity_events_rating_check failed on every affected message
// because Math.round(5.9) = 6, outside the column's 1-5 constraint.
//
// Allows a short run of words between the keyword and the number
// (up to 30 characters, non-greedy) rather than requiring the digit
// immediately after -- confirmed against a real Booksy review email:
// "The client has rated this appointment as: 5 on a 1-to-5 scale."
// would not match a keyword-then-digit pattern with nothing allowed
// in between.
function parseRating(text) {
  const starMatch = text.match(/(?:rating|rated|stars?)\b[\s\S]{0,30}?([1-5](?:\.\d)?)\b/i);
  if (starMatch) {
    const rounded = Math.round(Number(starMatch[1]));
    return rounded >= 1 && rounded <= 5 ? rounded : null;
  }

  const unicodeStars = text.match(/(★+)/);
  if (unicodeStars) return Math.max(1, Math.min(5, unicodeStars[1].length));

  const wordStars = text.match(/\b(five|four|three|two|one)\s+stars?\b/i);
  if (!wordStars) return null;
  return {
    five: 5,
    four: 4,
    one: 1,
    three: 3,
    two: 2,
  }[wordStars[1].toLowerCase()] || null;
}

function parseDateTime(fields, fallbackText) {
  const explicit = fields.appointmentDate || fields.date || "";
  const time = fields.appointmentTime || fields.time || "";
  const combined = clean(`${explicit} ${time}`);
  const candidates = [
    combined,
    explicit,
    firstMatch(fallbackText, [
      /\b(?:on|for)\s+([A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
      /\b(\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?)/i,
      /\b(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
    ]),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const parsed = new Date(candidate.replace(/\bat\b/i, ""));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function parseBooksyDateTime(monthName, day, year, timeText) {
  const monthIndex = MONTHS[String(monthName || "").toLowerCase()];
  if (monthIndex === undefined) return null;

  const timeMatch = String(timeText || "").match(/(\d{1,2}):(\d{2})\s*([ap])\.m\./i);
  if (!timeMatch) return null;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const isPm = timeMatch[3].toLowerCase() === "p";
  if (isPm && hour !== 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;

  const parsed = new Date(Number(year), monthIndex, Number(day), hour, minute, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractLabelFields(text) {
  const fields = {};
  const labels = [
    ["staffName", /(?:staff|professional|provider|employee|specialist|barber|tech|with)\s*[:\-]\s*([^\n]+)/i],
    ["staffEmail", /(?:staff email|provider email|employee email)\s*[:\-]\s*([^\s\n]+)/i],
    ["clientName", /(?:client|customer|booked by|reviewer)\s*[:\-]\s*([^\n]+)/i],
    ["clientEmail", /(?:client email|customer email)\s*[:\-]\s*([^\s\n]+)/i],
    ["clientPhone", /(?:client phone|customer phone|phone)\s*[:\-]\s*([^\n]+)/i],
    ["serviceName", /(?:service|appointment type|treatment)\s*[:\-]\s*([^\n]+)/i],
    ["appointmentDate", /(?:appointment date|date)\s*[:\-]\s*([^\n]+)/i],
    ["appointmentTime", /(?:appointment time|time)\s*[:\-]\s*([^\n]+)/i],
    ["bookingIdentifier", /(?:booking id|booking identifier|appointment id|reservation id|booksy id)\s*[:#\-]\s*([A-Za-z0-9_-]+)/i],
    ["price", /(?:price|amount|total)\s*[:\-]\s*(\$?\d[\d,]*(?:\.\d{2})?)/i],
    ["location", /(?:location|business|salon)\s*[:\-]\s*([^\n]+)/i],
    // Allows an optional word (e.g. "content") between the keyword
    // and the colon -- confirmed against a real Booksy review email:
    // "Review content: Amazing service super fast". Captures up to
    // the first newline rather than [\s\S], since clean() collapses
    // all whitespace (including newlines) before any later
    // truncation step would run, so stopping the capture itself
    // before it reaches the next paragraph of boilerplate is the
    // only place this can actually be bounded correctly.
    ["reviewText", /(?:review|comment|feedback)\s*(?:content)?\s*[:\-]\s*([^\n]{5,800})/i],
  ];

  labels.forEach(([key, pattern]) => {
    const value = firstMatch(text, [pattern]);
    if (value) fields[key] = value.replace(/\n{2,}[\s\S]*$/, "").trim();
  });

  if (!fields.staffName) {
    fields.staffName = firstMatch(text, [
      /\bwith\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\b/,
      /\bprovider\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\b/i,
    ]);
  }

  if (!fields.serviceName) {
    fields.serviceName = firstMatch(text, [
      /\bfor\s+([A-Z][A-Za-z0-9&' -]{3,50})\s+(?:with|on|at)\b/,
    ]);
  }

  if (fields.price !== undefined) fields.price = parseMoney(fields.price);
  return fields;
}

// Anchored to Booksy's real, unlabeled narrative layout. Every notification email
// (new booking, cancellation, reschedule, etc.) repeats this same block near the
// top: client name, optional phone, a "mailto:" line, the appointment date/time,
// a "<CATEGORY> SERVICE(S): <name>" line, a price line, and a "with" line
// followed by "<Staff Name> | <Role>".
function extractBookingFields(body) {
  const lines = String(body || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const fields = {};

  const emailLineIndex = lines.findIndex((line) => /mailto:/i.test(line));
  if (emailLineIndex !== -1) {
    const emailMatch = lines[emailLineIndex].match(/mailto:([^\s]+@[^\s]+?)(?=\s|$)/i);
    if (emailMatch) fields.clientEmail = emailMatch[1];

    let nameIndex = emailLineIndex - 1;
    if (nameIndex >= 0 && /^\(\d{3}\)\s?\d{3}-\d{4}$/.test(lines[nameIndex])) {
      fields.clientPhone = lines[nameIndex];
      nameIndex -= 1;
    }
    if (nameIndex >= 0 && lines[nameIndex]) {
      fields.clientName = lines[nameIndex];
    }
  }

  const dateLine = lines.find((line) =>
    /^[A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}\s*[ap]\.m\.\s*-\s*\d{1,2}:\d{2}\s*[ap]\.m\.$/i.test(line)
  );
  if (dateLine) {
    const match = dateLine.match(
      /^[A-Za-z]+,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}:\d{2}\s*[ap]\.m\.)\s*-\s*(\d{1,2}:\d{2}\s*[ap]\.m\.)$/i,
    );
    if (match) {
      const [, month, day, year, startTime, endTime] = match;
      fields.appointmentStartAt = parseBooksyDateTime(month, day, year, startTime);
      fields.appointmentEndAt = parseBooksyDateTime(month, day, year, endTime);
    }
  }

  const serviceLine = lines.find((line) => /SERVICES?:/i.test(line));
  if (serviceLine) {
    const match = serviceLine.match(/SERVICES?:\s*(.+)$/i);
    if (match) fields.serviceName = match[1].trim();
  }

  const priceLine = lines.find((line) => /^\$\d/.test(line));
  if (priceLine) {
    const match = priceLine.match(/^\$(\d+(?:\.\d{2})?)/);
    if (match) fields.price = parseMoney(match[1]);
  }

  const withIndex = lines.findIndex((line) => /^with$/i.test(line));
  if (withIndex !== -1 && lines[withIndex + 1]) {
    const staffMatch = lines[withIndex + 1].match(/^(.+?)\s*\|\s*(.+)$/);
    if (staffMatch) {
      fields.staffName = staffMatch[1].trim();
      fields.staffRole = staffMatch[2].trim();
    } else {
      fields.staffName = lines[withIndex + 1];
    }
  }

  const customerNoteIndex = lines.findIndex((line) => /^A note from the customer:$/i.test(line));
  if (customerNoteIndex !== -1) {
    let endIndex = lines.length;
    for (let i = customerNoteIndex + 1; i < lines.length; i += 1) {
      if (/^A note from the business:$/i.test(lines[i])) {
        endIndex = i;
        break;
      }
    }
    const noteLines = lines.slice(customerNoteIndex + 1, endIndex);
    if (noteLines.length) fields.customerNote = noteLines.join(" ").trim();
  }

  return fields;
}

function detectFromSubject(subject) {
  const text = String(subject || "");
  return SUBJECT_RULES.find((rule) => rule.pattern.test(text)) || null;
}

function detectFromBody(subject, body) {
  const text = textForMatching(subject, body);
  return EVENT_TEMPLATES.find((template) =>
    template.patterns.some((pattern) => pattern.test(text)),
  ) || null;
}

function detectTemplate(subject, body) {
  return detectFromSubject(subject) || detectFromBody(subject, body);
}

export function parseBooksyEmail({ body = "", headers = {}, internalDate = null, messageId = "", subject = "", threadId = "" } = {}) {
  const normalizedBody = normalizeBody(body);
  const matchingText = textForMatching(subject, normalizedBody);
  const template = detectTemplate(subject, normalizedBody);
  const labelFields = extractLabelFields(normalizedBody);
  const bookingFields = extractBookingFields(normalizedBody);
  const fields = { ...labelFields, ...bookingFields };
  const sourceTimestamp = safeIsoDate(headers.date) || safeIsoMillis(internalDate) || new Date().toISOString();
  const eventType = template?.eventType || "unknown";
  const event = {
    appointmentEndAt: fields.appointmentEndAt || null,
    appointmentStartAt: fields.appointmentStartAt || parseDateTime(fields, matchingText),
    bookingIdentifier: fields.bookingIdentifier || "",
    clientEmail: fields.clientEmail || "",
    clientName: fields.clientName || "",
    clientPhone: fields.clientPhone || "",
    eventType,
    location: "",
    parserTemplate: template?.name || "unknown",
    parserVersion: BOOKSY_PARSER_VERSION,
    price: fields.price ?? null,
    rating: eventType === "new_review" ? parseRating(matchingText) : null,
    reviewText: eventType === "new_review" ? (fields.reviewText || "") : (fields.customerNote || ""),
    serviceName: fields.serviceName || "",
    sourceEventId: `${messageId}:${eventType}:${fields.bookingIdentifier || "no-booking"}`,
    sourceMessageId: messageId,
    sourceThreadId: threadId,
    sourceTimestamp,
    staffEmail: fields.staffEmail || "",
    staffName: fields.staffName || "",
    raw: {
      body: normalizedBody.slice(0, 12000),
      headers,
      subject,
      template: template?.name || "unknown",
    },
  };

  return {
    events: [event],
    parserVersion: BOOKSY_PARSER_VERSION,
    templateName: template?.name || "unknown",
    unknown: !template,
  };
}

export function parseBooksyCsvRows(rows = []) {
  return rows.map((row, index) => {
    const rawEventType = String(row.event_type || row.status || "").toLowerCase();
    const hasReview = Boolean(row.rating || row.review_text || row.review || row.comment);
    const eventType = hasReview
      ? "new_review"
      : rawEventType.includes("cancel")
      ? "appointment_cancelled"
      : rawEventType.includes("resched")
      ? "appointment_rescheduled"
      : rawEventType.includes("updated") || rawEventType.includes("changed")
      ? "appointment_updated"
      : "appointment_created";
    return {
      appointmentEndAt: row.appointment_end_at || null,
      appointmentStartAt: row.appointment_start_at || row.date_time || row.date || null,
      bookingIdentifier: row.booking_identifier || row.booking_id || row.appointment_id || "",
      clientEmail: row.client_email || "",
      clientName: row.client_name || row.customer || "",
      clientPhone: row.client_phone || "",
      eventType,
      location: row.location || "",
      parserTemplate: "booksy-csv-row",
      parserVersion: "booksy-csv-v1",
      price: parseMoney(row.price || row.amount),
      rating: (() => {
        if (!row.rating) return null;
        const rounded = Math.round(Number(row.rating));
        return rounded >= 1 && rounded <= 5 ? rounded : null;
      })(),
      reviewText: row.review_text || row.review || row.comment || "",
      serviceName: row.service || row.service_name || "",
      sourceEventId:
        row.external_id ||
        row.id ||
        row.booking_identifier ||
        row.booking_id ||
        row.appointment_id ||
        `csv-row-${index + 1}`,
      sourceMessageId: "",
      sourceThreadId: "",
      sourceTimestamp: row.source_timestamp || row.updated_at || new Date().toISOString(),
      staffEmail: row.staff_email || "",
      staffName: row.staff_name || row.staff || "",
      raw: row,
    };
  });
}
