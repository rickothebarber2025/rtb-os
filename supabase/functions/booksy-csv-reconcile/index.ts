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
import { parseBooksyCsvRows } from "../_shared/booksy-parser.js";
import {
  createSyncRun,
  finishSyncRun,
  loadAttributionContext,
  persistParsedEvent,
} from "../_shared/source-sync.js";

const BOOKSY_CSV_PARSER_VERSION = "booksy-csv-v1";

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

function parseCsvText(csvText: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current || row.length) {
    row.push(current.trim());
    if (row.some(Boolean)) rows.push(row);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((header) =>
    header
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, ""),
  );

  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))
  );
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
    const rowLimit = maxBatchSize(body.maxRows || body.max_rows, 250, 1000);
    const rows = Array.isArray(body.rows)
      ? body.rows.slice(0, rowLimit) as Record<string, unknown>[]
      : parseCsvText(String(body.csvText || body.csv_text || "")).slice(0, rowLimit);

    if (!rows.length) throw new RequestError("Provide Booksy CSV rows or csvText.", 400);

    syncRunId = await createSyncRun(admin, {
      businessUnitId,
      metadata: { mode: actor.worker ? "worker" : "user", rowLimit },
      parserVersion: BOOKSY_CSV_PARSER_VERSION,
      requestedBy: actor.user?.id || null,
      source: "booksy_csv",
    });

    const attributionContext = await loadAttributionContext(admin, businessUnitId);
    const events = parseBooksyCsvRows(rows);
    const totals = {
      duplicate: 0,
      errors: 0,
      inserted: 0,
      processed: 0,
      unresolved: 0,
      updated: 0,
    };
    const details = [];

    for (const event of events) {
      try {
        const persisted = await persistParsedEvent(admin, {
          attributionContext,
          businessUnitId,
          event,
          source: "booksy_csv",
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
          eventType: event.eventType,
          sourceEventId: event.sourceEventId,
          sourceTable: persisted.sourceTable,
          status: persisted.assignment.status,
        });
      } catch (err) {
        totals.errors += 1;
        details.push({ error: err.message || "CSV row failed.", sourceEventId: event.sourceEventId });
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
      metadata: { details: details.slice(0, 100), row_count: rows.length },
    });

    return jsonResponse({ ...totals, syncRunId });
  } catch (err) {
    if (admin && syncRunId) {
      await finishSyncRun(admin, syncRunId, {
        error_count: 1,
        error_message: err.message || "Booksy CSV reconciliation failed.",
        status: "failed",
      }).catch(() => {});
    }

    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse({ error: err.message || "Booksy CSV reconciliation failed." }, status);
  }
});
