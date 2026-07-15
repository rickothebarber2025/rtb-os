import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authorizeManager,
  corsHeaders,
  getAdminClient,
  jsonResponse,
  maxBatchSize,
  readJson,
  RequestError,
} from "../_shared/rtb.ts";
import {
  createSyncRun,
  finishSyncRun,
  loadAttributionContext,
  persistParsedEvent,
} from "../_shared/source-sync.js";

const GOOGLE_REVIEWS_PARSER_VERSION = "google-business-profile-reviews-v1";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

function assertBusinessId(value: unknown) {
  const businessUnitId = String(value || "").trim();
  if (!businessUnitId) throw new RequestError("businessUnitId is required.", 400);
  return businessUnitId;
}

async function authorizeSync(req: Request, admin: ReturnType<typeof getAdminClient>, businessUnitId: string) {
  const expectedWorkerToken = Deno.env.get("RTB_SYNC_WORKER_TOKEN") || "";
  const providedWorkerToken = req.headers.get("x-rtb-worker-token") || "";

  if (expectedWorkerToken && providedWorkerToken && providedWorkerToken === expectedWorkerToken) {
    return { profile: null, user: null, worker: true };
  }

  const actor = await authorizeManager(req, admin, businessUnitId, [
    { module: "performance", minimum: "edit" },
    { module: "operations", minimum: "edit" },
    { module: "appointments", minimum: "edit" },
  ]);
  return { ...actor, worker: false };
}

function getGoogleAuthConfig() {
  const accessToken =
    Deno.env.get("GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN") ||
    Deno.env.get("GOOGLE_ACCESS_TOKEN") ||
    "";
  const refreshToken =
    Deno.env.get("GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN") ||
    Deno.env.get("GOOGLE_REFRESH_TOKEN") ||
    "";
  const clientId =
    Deno.env.get("GOOGLE_BUSINESS_PROFILE_CLIENT_ID") ||
    Deno.env.get("GOOGLE_CLIENT_ID") ||
    "";
  const clientSecret =
    Deno.env.get("GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET") ||
    Deno.env.get("GOOGLE_CLIENT_SECRET") ||
    "";

  return { accessToken, clientId, clientSecret, refreshToken };
}

async function getGoogleAccessToken() {
  const config = getGoogleAuthConfig();
  if (config.accessToken) return config.accessToken;

  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new RequestError(
      "Google Business Profile secrets are missing. Add GOOGLE_BUSINESS_PROFILE_CLIENT_ID, GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET, and GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN, or add GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN.",
      500,
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    throw new RequestError(
      payload.error_description || payload.error || "Google Business Profile connection expired or could not be refreshed.",
      502,
    );
  }

  return payload.access_token as string;
}

function getLocationName(body: Record<string, unknown>, businessUnitId: string) {
  const explicit = String(body.locationName || body.location_name || "").trim();
  if (explicit) return explicit.replace(/^\/+/, "");

  const mappingRaw = Deno.env.get("GOOGLE_BUSINESS_PROFILE_LOCATIONS") || "{}";
  let mapping: Record<string, unknown> = {};

  try {
    mapping = JSON.parse(mappingRaw);
  } catch (_err) {
    throw new RequestError("GOOGLE_BUSINESS_PROFILE_LOCATIONS must be valid JSON.", 500);
  }

  const mapped = mapping[businessUnitId] || mapping.default;
  if (typeof mapped === "string" && mapped.trim()) return mapped.trim().replace(/^\/+/, "");

  throw new RequestError(
    "Google Business Profile location is missing. Pass locationName or add GOOGLE_BUSINESS_PROFILE_LOCATIONS as JSON keyed by businessUnitId.",
    400,
  );
}

function googleRatingToNumber(value: unknown) {
  if (typeof value === "number") return Math.max(1, Math.min(5, Math.round(value)));
  const text = String(value || "").toUpperCase();
  return {
    FIVE: 5,
    FOUR: 4,
    ONE: 1,
    THREE: 3,
    TWO: 2,
  }[text] || null;
}

function reviewToEvent(review: Record<string, any>, locationName: string) {
  const reviewerName = String(review.reviewer?.displayName || review.reviewer?.name || "");
  const reviewText = String(review.comment || "");

  return {
    appointmentEndAt: null,
    appointmentStartAt: null,
    bookingIdentifier: "",
    clientEmail: "",
    clientName: reviewerName,
    clientPhone: "",
    eventType: "new_review",
    externalReviewId: String(review.reviewId || review.name || ""),
    location: locationName,
    parserTemplate: "google-business-profile-review",
    parserVersion: GOOGLE_REVIEWS_PARSER_VERSION,
    price: null,
    publishedAt: review.createTime || review.updateTime || null,
    rating: googleRatingToNumber(review.starRating),
    reviewerName,
    reviewText,
    reviewUrl: review.reviewReply?.updateTime ? "" : "",
    serviceName: "",
    sourceEventId: String(review.reviewId || review.name || ""),
    sourceMessageId: "",
    sourceThreadId: "",
    sourceTimestamp: review.updateTime || review.createTime || new Date().toISOString(),
    staffEmail: "",
    staffName: "",
    raw: {
      locationName,
      review,
    },
  };
}

async function googleBusinessProfileRequest(accessToken: string, path: string) {
  const response = await fetch(`${GBP_API_BASE}/${path.replace(/^\/+/, "")}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new RequestError(
      payload.error?.message || payload.error || "Google Business Profile API request failed.",
      response.status,
    );
  }

  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let syncRunId: string | null = null;
  let admin: ReturnType<typeof getAdminClient> | null = null;

  try {
    if (req.method !== "POST") throw new RequestError("POST is required.", 405);

    admin = getAdminClient();
    const body = await readJson(req) as Record<string, unknown>;
    const businessUnitId = assertBusinessId(body.businessUnitId || body.business_unit_id);
    const actor = await authorizeSync(req, admin, businessUnitId);
    const locationName = getLocationName(body, businessUnitId);
    const maxPages = maxBatchSize(body.maxPages || body.max_pages, 1, 10);
    const pageSize = maxBatchSize(body.pageSize || body.page_size, 50, 50);
    const accessToken = await getGoogleAccessToken();

    syncRunId = await createSyncRun(admin, {
      businessUnitId,
      metadata: { locationName, maxPages, mode: actor.worker ? "worker" : "user", pageSize },
      parserVersion: GOOGLE_REVIEWS_PARSER_VERSION,
      requestedBy: actor.user?.id || null,
      source: "google_business_profile",
    });

    const attributionContext = await loadAttributionContext(admin, businessUnitId);
    const totals = {
      duplicate: 0,
      errors: 0,
      inserted: 0,
      processed: 0,
      unresolved: 0,
      updated: 0,
    };
    const details = [];
    let pageToken = "";

    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({
        orderBy: "updateTime desc",
        pageSize: String(pageSize),
      });
      if (pageToken) params.set("pageToken", pageToken);

      const payload = await googleBusinessProfileRequest(
        accessToken,
        `${locationName}/reviews?${params.toString()}`,
      );

      for (const review of payload.reviews || []) {
        try {
          const event = reviewToEvent(review, locationName);
          const persisted = await persistParsedEvent(admin, {
            attributionContext,
            businessUnitId,
            event,
            source: "google_business_profile",
            syncRunId,
          });
          totals.processed += 1;
          if (persisted.duplicate) {
            totals.duplicate += 1;
            totals.updated += 1;
          } else {
            totals.inserted += 1;
          }
          if (persisted.queued) totals.unresolved += 1;
          details.push({
            externalReviewId: event.externalReviewId,
            rating: event.rating,
            sourceTable: persisted.sourceTable,
            status: persisted.assignment.status,
          });
        } catch (err) {
          totals.errors += 1;
          details.push({ error: err.message || "Review failed.", reviewName: review.name || review.reviewId });
        }
      }

      pageToken = payload.nextPageToken || "";
      if (!pageToken) break;
    }

    await finishSyncRun(admin, syncRunId, {
      duplicate_count: totals.duplicate,
      error_count: totals.errors,
      inserted_count: totals.inserted,
      processed_count: totals.processed,
      status: totals.errors ? "partial" : "completed",
      unresolved_count: totals.unresolved,
      updated_count: totals.updated,
      metadata: { details: details.slice(0, 100), locationName },
    });

    return jsonResponse({ ...totals, locationName, syncRunId });
  } catch (err) {
    if (admin && syncRunId) {
      await finishSyncRun(admin, syncRunId, {
        error_count: 1,
        error_message: err.message || "Google review sync failed.",
        status: "failed",
      }).catch(() => {});
    }

    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse({ error: err.message || "Google review sync failed." }, status);
  }
});
