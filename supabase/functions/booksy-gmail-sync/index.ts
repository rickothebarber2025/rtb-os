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
import { BOOKSY_PARSER_VERSION, parseBooksyEmail } from "../_shared/booksy-parser.js";
import {
  createSyncRun,
  finishSyncRun,
  loadAttributionContext,
  persistParsedEvent,
} from "../_shared/source-sync.js";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const DEFAULT_BOOKSY_LABEL = "RTB-OS/Booksy";

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
    { module: "appointments", minimum: "edit" },
    { module: "operations", minimum: "edit" },
  ]);
  return { ...actor, worker: false };
}

function getGoogleAuthConfig() {
  const accessToken =
    Deno.env.get("GOOGLE_GMAIL_ACCESS_TOKEN") ||
    Deno.env.get("GOOGLE_ACCESS_TOKEN") ||
    "";
  const refreshToken =
    Deno.env.get("GOOGLE_GMAIL_REFRESH_TOKEN") ||
    Deno.env.get("GOOGLE_REFRESH_TOKEN") ||
    "";
  const clientId =
    Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") ||
    Deno.env.get("GOOGLE_CLIENT_ID") ||
    "";
  const clientSecret =
    Deno.env.get("GOOGLE_GMAIL_CLIENT_SECRET") ||
    Deno.env.get("GOOGLE_CLIENT_SECRET") ||
    "";

  return { accessToken, clientId, clientSecret, refreshToken };
}

async function getGoogleAccessToken() {
  const config = getGoogleAuthConfig();
  if (config.accessToken) return config.accessToken;

  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new RequestError(
      "Google Gmail sync secrets are missing. Add GOOGLE_GMAIL_CLIENT_ID, GOOGLE_GMAIL_CLIENT_SECRET, and GOOGLE_GMAIL_REFRESH_TOKEN, or add GOOGLE_GMAIL_ACCESS_TOKEN.",
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
      payload.error_description || payload.error || "Google Gmail connection expired or could not be refreshed.",
      502,
    );
  }

  return payload.access_token as string;
}

async function gmailRequest(accessToken: string, path: string) {
  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new RequestError(
      payload.error?.message || payload.error || "Gmail API request failed.",
      response.status,
    );
  }

  return payload;
}

async function findLabelId(accessToken: string, userId: string, labelName: string, explicitLabelId = "") {
  if (explicitLabelId) return explicitLabelId;

  const payload = await gmailRequest(accessToken, `/users/${encodeURIComponent(userId)}/labels`);
  const label = (payload.labels || []).find((item: Record<string, unknown>) =>
    String(item.name || "").trim().toLowerCase() === labelName.trim().toLowerCase()
  );

  if (!label?.id) {
    throw new RequestError(`Gmail label "${labelName}" was not found. Create it first and apply it to Booksy emails.`, 400);
  }

  return String(label.id);
}

function decodeBase64Url(value = "") {
  if (!value) return "";
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (_err) {
    return "";
  }
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function collectMessageBodies(payload: Record<string, any> | null, texts: { html: string[]; plain: string[] }) {
  if (!payload) return;

  const data = payload.body?.data ? decodeBase64Url(payload.body.data) : "";
  if (data && String(payload.mimeType || "").includes("text/plain")) texts.plain.push(data);
  if (data && String(payload.mimeType || "").includes("text/html")) texts.html.push(stripHtml(data));

  (payload.parts || []).forEach((part: Record<string, any>) => collectMessageBodies(part, texts));
}

function parseGmailMessage(message: Record<string, any>) {
  const headers = Object.fromEntries(
    (message.payload?.headers || []).map((header: Record<string, unknown>) => [
      String(header.name || "").toLowerCase(),
      String(header.value || ""),
    ]),
  );
  const texts = { html: [] as string[], plain: [] as string[] };
  collectMessageBodies(message.payload || null, texts);

  return {
    body: texts.plain.join("\n\n").trim() || texts.html.join("\n\n").trim() || String(message.snippet || ""),
    headers,
    internalDate: message.internalDate || null,
    messageId: String(message.id || ""),
    subject: headers.subject || "",
    threadId: String(message.threadId || ""),
  };
}

async function messageAlreadyProcessed(admin: ReturnType<typeof getAdminClient>, businessUnitId: string, messageId: string) {
  const [activityResult, reviewResult] = await Promise.all([
    admin
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .eq("business_unit_id", businessUnitId)
      .eq("source_message_id", messageId),
    admin
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("business_unit_id", businessUnitId)
      .eq("source_message_id", messageId),
  ]);

  if (activityResult.error) throw activityResult.error;
  if (reviewResult.error) throw reviewResult.error;
  return Boolean((activityResult.count || 0) + (reviewResult.count || 0));
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
    const labelName = String(body.labelName || body.label_name || Deno.env.get("BOOKSY_GMAIL_LABEL") || DEFAULT_BOOKSY_LABEL);
    const labelIdInput = String(body.labelId || body.label_id || Deno.env.get("BOOKSY_GMAIL_LABEL_ID") || "");
    const userId = String(body.userId || body.user_id || Deno.env.get("BOOKSY_GMAIL_USER") || "me");
    const maxMessages = maxBatchSize(body.maxMessages || body.max_messages, 25, 100);
    const accessToken = await getGoogleAccessToken();
    const gmailLabelId = await findLabelId(accessToken, userId, labelName, labelIdInput);

    syncRunId = await createSyncRun(admin, {
      businessUnitId,
      metadata: { gmailLabelId, labelName, maxMessages, mode: actor.worker ? "worker" : "user" },
      parserVersion: BOOKSY_PARSER_VERSION,
      requestedBy: actor.user?.id || null,
      source: "booksy_gmail",
    });

    const listPayload = await gmailRequest(
      accessToken,
      `/users/${encodeURIComponent(userId)}/messages?${new URLSearchParams({
        includeSpamTrash: "false",
        labelIds: gmailLabelId,
        maxResults: String(maxMessages),
      }).toString()}`,
    );

    const attributionContext = await loadAttributionContext(admin, businessUnitId);
    const messages = listPayload.messages || [];
    const totals = {
      duplicate: 0,
      errors: 0,
      inserted: 0,
      processed: 0,
      unresolved: 0,
      updated: 0,
      unknown: 0,
    };
    const details = [];

    for (const message of messages) {
      const messageId = String(message.id || "");
      if (!messageId) continue;

      try {
        if (await messageAlreadyProcessed(admin, businessUnitId, messageId)) {
          totals.duplicate += 1;
          continue;
        }

        const fullMessage = await gmailRequest(
          accessToken,
          `/users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}?format=full`,
        );
        const parsedMessage = parseGmailMessage(fullMessage);
        const parsed = parseBooksyEmail(parsedMessage);
        if (parsed.unknown) totals.unknown += 1;

        for (const event of parsed.events) {
          const persisted = await persistParsedEvent(admin, {
            attributionContext,
            businessUnitId,
            event,
            source: "booksy_email",
            syncRunId,
          });
          totals.processed += 1;
          if (persisted.duplicate) totals.updated += 1;
          else totals.inserted += 1;
          if (persisted.queued) totals.unresolved += 1;
          details.push({
            eventType: event.eventType,
            messageId,
            sourceTable: persisted.sourceTable,
            status: persisted.assignment.status,
          });
        }
      } catch (err) {
        totals.errors += 1;
        details.push({ error: err.message || "Message failed.", messageId });
      }
    }

    await finishSyncRun(admin, syncRunId, {
      duplicate_count: totals.duplicate,
      error_count: totals.errors,
      inserted_count: totals.inserted,
      processed_count: totals.processed,
      status: totals.errors ? "partial" : "completed",
      unresolved_count: totals.unresolved,
      updated_count: totals.updated,
      metadata: { details: details.slice(0, 100), labelName, unknown_templates: totals.unknown },
    });

    return jsonResponse({
      ...totals,
      labelName,
      syncRunId,
    });
  } catch (err) {
    if (admin && syncRunId) {
      await finishSyncRun(admin, syncRunId, {
        error_count: 1,
        error_message: err.message || "Booksy Gmail sync failed.",
        status: "failed",
      }).catch(() => {});
    }

    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse({ error: err.message || "Booksy Gmail sync failed." }, status);
  }
});
