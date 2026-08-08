import {
  assignmentNeedsManagerReview,
  buildStaffCandidates,
  matchStaffAssignment,
} from "./source-attribution.js";

function cleanText(value) {
  return String(value || "").trim();
}

// Number(null) === 0 in JavaScript -- a real, confirmed bug: every
// non-review activity_event correctly gets rating: null from the
// parser, but this helper silently turned that into 0, which fails
// the activity_events_rating_check constraint (0 is neither NULL
// nor >= 1). This was the actual root cause of "activity_events_
// rating_check" failures on every single non-review Booksy email,
// not a parser bug at all -- confirmed by reproducing
// numericOrNull(null) directly and getting 0 back instead of null.
function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sourceTypeFor(source) {
  if (String(source || "").startsWith("google")) return "google_review";
  if (String(source || "").includes("csv")) return "booksy_csv";
  return "booksy_email";
}

// assignment_matches.status has a stricter allowed set than unresolved_items.status
// (no "unresolved" value there - it uses "unassigned" instead). Map at the boundary
// so the shared assignment.status vocabulary used elsewhere doesn't have to change.
function assignmentMatchesStatus(status) {
  return status === "unresolved" ? "unassigned" : status;
}

export async function loadAttributionContext(admin, businessUnitId) {
  const [staffResult, identitiesResult, aliasesResult, eventResult] = await Promise.all([
    admin
      .from("staff")
      .select("id,active,business_unit_id,business_location,email,full_name,preferred_name,services_offered")
      .eq("business_unit_id", businessUnitId),
    admin
      .from("staff_source_identities")
      .select("*")
      .eq("business_unit_id", businessUnitId)
      .eq("active", true),
    admin
      .from("staff_aliases")
      .select("*")
      .eq("business_unit_id", businessUnitId),
    admin
      .from("activity_events")
      .select("booking_identifier,staff_id")
      .eq("business_unit_id", businessUnitId)
      .not("booking_identifier", "is", null)
      .not("staff_id", "is", null)
      .limit(5000),
  ]);

  if (staffResult.error) throw staffResult.error;
  if (identitiesResult.error) throw identitiesResult.error;
  if (aliasesResult.error) throw aliasesResult.error;
  if (eventResult.error) throw eventResult.error;

  const bookingStaffById = new Map(
    (eventResult.data || [])
      .filter((row) => row.booking_identifier && row.staff_id)
      .map((row) => [String(row.booking_identifier), row.staff_id]),
  );

  return {
    bookingStaffById,
    candidates: buildStaffCandidates({
      aliases: aliasesResult.data || [],
      identities: identitiesResult.data || [],
      staff: staffResult.data || [],
    }),
    staff: staffResult.data || [],
  };
}

async function findExistingActivity(admin, businessUnitId, event, source) {
  if (event.sourceEventId) {
    const { data, error } = await admin
      .from("activity_events")
      .select("id")
      .eq("business_unit_id", businessUnitId)
      .eq("source", source)
      .eq("source_event_id", event.sourceEventId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
  }

  if (event.sourceMessageId) {
    let query = admin
      .from("activity_events")
      .select("id")
      .eq("business_unit_id", businessUnitId)
      .eq("source", source)
      .eq("source_message_id", event.sourceMessageId)
      .eq("event_type", event.eventType);

    if (event.bookingIdentifier) {
      query = query.eq("booking_identifier", event.bookingIdentifier);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
  }

  return null;
}

async function findExistingReview(admin, businessUnitId, event, source) {
  const externalReviewId = event.externalReviewId || event.sourceEventId || event.sourceMessageId;
  if (externalReviewId) {
    const { data, error } = await admin
      .from("reviews")
      .select("id")
      .eq("business_unit_id", businessUnitId)
      .eq("source", source)
      .eq("external_review_id", externalReviewId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
  }

  if (event.sourceMessageId) {
    const { data, error } = await admin
      .from("reviews")
      .select("id")
      .eq("business_unit_id", businessUnitId)
      .eq("source", source)
      .eq("source_message_id", event.sourceMessageId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
  }

  return null;
}

async function recordAssignment(admin, {
  assignment,
  businessUnitId,
  recordId,
  source,
  sourceTable,
}) {
  const payload = {
    alternative_matches: assignment.alternativeMatches || [],
    business_unit_id: businessUnitId,
    confidence_score: assignment.confidence,
    match_reasons: assignment.reasons || [],
    source_record_id: recordId,
    source_table: sourceTable,
    source_type: sourceTypeFor(source),
    staff_id: assignment.staffId,
    status: assignmentMatchesStatus(assignment.status),
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("assignment_matches").insert(payload);
  if (error) throw error;
}

async function enqueueIfNeeded(admin, {
  assignment,
  businessUnitId,
  event,
  itemType,
  recordId,
  sourceTable,
}) {
  if (!assignmentNeedsManagerReview(assignment)) return false;

  const { error } = await admin.from("unresolved_items").upsert(
    {
      alternative_matches: assignment.alternativeMatches || [],
      business_unit_id: businessUnitId,
      confidence_score: assignment.confidence,
      item_type: itemType,
      matching_reasons: assignment.reasons || [],
      proposed_staff_id: assignment.staffId,
      raw_payload: event.raw || event,
      source_record_id: recordId,
      source_table: sourceTable,
      status: "unresolved",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source_table,source_record_id" },
  );

  if (error) throw error;
  return true;
}

function activityPayload(event, businessUnitId, source, syncRunId, assignment) {
  return {
    appointment_end_at: isoOrNull(event.appointmentEndAt),
    appointment_start_at: isoOrNull(event.appointmentStartAt),
    assignment_confidence: assignment.confidence,
    assignment_reason: assignment.explanation,
    assignment_status: assignment.status,
    booking_identifier: cleanText(event.bookingIdentifier) || null,
    business_unit_id: businessUnitId,
    client_email: cleanText(event.clientEmail) || null,
    client_name: cleanText(event.clientName) || null,
    client_phone: cleanText(event.clientPhone) || null,
    event_type: event.eventType || "unknown",
    location: cleanText(event.location) || null,
    parser_version: event.parserVersion || "booksy-email-v1",
    price: numericOrNull(event.price),
    rating: numericOrNull(event.rating),
    raw_payload: event.raw || event,
    review_text: cleanText(event.reviewText) || null,
    service_name: cleanText(event.serviceName) || null,
    source,
    source_event_id: cleanText(event.sourceEventId) || null,
    source_message_id: cleanText(event.sourceMessageId) || null,
    source_thread_id: cleanText(event.sourceThreadId) || null,
    source_timestamp: isoOrNull(event.sourceTimestamp),
    staff_id: assignment.staffId,
    sync_run_id: syncRunId,
    updated_at: new Date().toISOString(),
  };
}

function reviewPayload(event, businessUnitId, source, syncRunId, assignment) {
  return {
    assignment_confidence: assignment.confidence,
    assignment_reason: assignment.explanation,
    assignment_status: assignment.status,
    business_unit_id: businessUnitId,
    customer_email: cleanText(event.clientEmail || event.customerEmail) || null,
    customer_name: cleanText(event.clientName || event.customerName) || null,
    external_review_id: cleanText(event.externalReviewId || event.sourceEventId || event.sourceMessageId) || null,
    location: cleanText(event.location) || null,
    published_at: isoOrNull(event.publishedAt || event.sourceTimestamp),
    rating: numericOrNull(event.rating),
    raw_payload: event.raw || event,
    review_text: cleanText(event.reviewText) || null,
    review_url: cleanText(event.reviewUrl) || null,
    reviewer_name: cleanText(event.reviewerName || event.clientName || event.customerName) || null,
    service_name: cleanText(event.serviceName) || null,
    source,
    source_message_id: cleanText(event.sourceMessageId) || null,
    source_timestamp: isoOrNull(event.sourceTimestamp),
    staff_id: assignment.staffId,
    sync_run_id: syncRunId,
    updated_at: new Date().toISOString(),
  };
}

export async function persistParsedEvent(admin, {
  attributionContext,
  businessUnitId,
  event,
  source = "booksy_email",
  syncRunId = null,
}) {
  const assignment = matchStaffAssignment(event, attributionContext.candidates, {
    allowGeneralBusiness: event.eventType === "new_review",
    bookingStaffById: attributionContext.bookingStaffById,
  });
  const isReview = event.eventType === "new_review" || source === "google_business_profile";
  const sourceTable = isReview ? "reviews" : "activity_events";
  const existing = isReview
    ? await findExistingReview(admin, businessUnitId, event, source)
    : await findExistingActivity(admin, businessUnitId, event, source);
  const payload = isReview
    ? reviewPayload(event, businessUnitId, source, syncRunId, assignment)
    : activityPayload(event, businessUnitId, source, syncRunId, assignment);

  let record;
  if (existing?.id) {
    const { data, error } = await admin
      .from(sourceTable)
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (error) throw error;
    record = data;
  } else {
    const { data, error } = await admin
      .from(sourceTable)
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    record = data;
  }

  await recordAssignment(admin, {
    assignment,
    businessUnitId,
    recordId: record.id,
    source,
    sourceTable,
  });
  const queued = await enqueueIfNeeded(admin, {
    assignment,
    businessUnitId,
    event,
    itemType: event.eventType === "unknown" ? "unknown_template" : isReview ? "review" : "activity_event",
    recordId: record.id,
    sourceTable,
  });

  return {
    assignment,
    duplicate: Boolean(existing?.id),
    queued,
    recordId: record.id,
    sourceTable,
  };
}

export async function createSyncRun(admin, {
  businessUnitId,
  metadata = {},
  parserVersion = null,
  requestedBy = null,
  source,
}) {
  const { data, error } = await admin
    .from("sync_runs")
    .insert({
      business_unit_id: businessUnitId || null,
      metadata,
      parser_version: parserVersion,
      requested_by: requestedBy,
      source,
      status: "running",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function finishSyncRun(admin, syncRunId, updates) {
  const { error } = await admin
    .from("sync_runs")
    .update({
      ...updates,
      completed_at: new Date().toISOString(),
    })
    .eq("id", syncRunId);
  if (error) throw error;
}
