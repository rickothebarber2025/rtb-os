export const BOOKSY_PARSER_VERSION = "booksy-email-v1";

const EVENT_TEMPLATES = [
  {
    eventType: "appointment_cancelled",
    name: "appointment-cancelled",
    patterns: [/cancel(l)?ed/i, /appointment.+cancel/i],
  },
  {
    eventType: "appointment_rescheduled",
    name: "appointment-rescheduled",
    patterns: [/rescheduled/i, /appointment.+moved/i, /changed.+time/i],
  },
  {
    eventType: "appointment_updated",
    name: "appointment-updated",
    patterns: [/appointment.+updated/i, /booking.+updated/i, /appointment.+changed/i],
  },
  {
    eventType: "appointment_created",
    name: "appointment-created",
    patterns: [/new appointment/i, /appointment.+created/i, /new booking/i, /booked.+appointment/i],
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

function parseRating(text) {
  const starMatch = text.match(/(?:rating|rated|stars?)\s*[:\-]?\s*([1-5](?:\.\d)?)/i);
  if (starMatch) return Math.round(Number(starMatch[1]));

  const unicodeStars = text.match(/(★+)/);
  if (unicodeStars) return Math.min(5, unicodeStars[1].length);

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
    ["reviewText", /(?:review|comment|feedback)\s*[:\-]\s*([\s\S]{5,800})/i],
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

  fields.price = parseMoney(fields.price);
  return fields;
}

function detectTemplate(subject, body) {
  const text = textForMatching(subject, body);
  return EVENT_TEMPLATES.find((template) =>
    template.patterns.some((pattern) => pattern.test(text)),
  ) || null;
}

export function parseBooksyEmail({ body = "", headers = {}, internalDate = null, messageId = "", subject = "", threadId = "" } = {}) {
  const normalizedBody = normalizeBody(body);
  const matchingText = textForMatching(subject, normalizedBody);
  const template = detectTemplate(subject, normalizedBody);
  const fields = extractLabelFields(normalizedBody);
  const sourceTimestamp = safeIsoDate(headers.date) || safeIsoMillis(internalDate) || new Date().toISOString();
  const eventType = template?.eventType || "unknown";
  const event = {
    appointmentEndAt: null,
    appointmentStartAt: parseDateTime(fields, matchingText),
    bookingIdentifier: fields.bookingIdentifier || "",
    clientEmail: fields.clientEmail || "",
    clientName: fields.clientName || "",
    clientPhone: fields.clientPhone || "",
    eventType,
    location: fields.location || "",
    parserTemplate: template?.name || "unknown",
    parserVersion: BOOKSY_PARSER_VERSION,
    price: fields.price,
    rating: eventType === "new_review" ? parseRating(matchingText) : null,
    reviewText: eventType === "new_review" ? fields.reviewText || "" : "",
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
      rating: row.rating ? Math.round(Number(row.rating)) : null,
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
