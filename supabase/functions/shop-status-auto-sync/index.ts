import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  RequestError,
  authorizeManager,
  corsHeaders,
  getAdminClient,
  jsonResponse,
} from "../_shared/rtb.ts";

// Reads Square order activity for both RTB locations plus the open_hours
// configured in shop_presence_settings, and writes into shop_status_events
// (the same table staff opening/closing checklist completion writes into)
// whenever the computed status changes, or at least every 3 hours as a
// freshness floor. This is what keeps the Command Center's open/closed
// chip live even for a location that hasn't had a checklist run in days.
// Scheduled every 15 minutes by the rtb-shop-status-auto-sync cron job
// (see supabase/migrations/20260910163000_shop_status_auto_sync_cron.sql).

type AdminClient = ReturnType<typeof createClient>;

const SQUARE_API_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") || "2026-05-20";

const LOCATIONS: Record<string, string> = {
  BYYR1W9SMFWS6: "RTB Lounge",
  LJK9F49SHT4B0: "RTB Beauty Lounge",
};

const ACTIVITY_WINDOW_MINUTES = 45;
const STALE_AFTER_MS = 3 * 60 * 60 * 1000; // refresh at least every 3h even if status unchanged

const OPERATIONS_REQUIREMENT = [{ module: "operations", minimum: "edit" }];

async function fetchSquare(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`${SQUARE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.errors?.[0]?.detail || `Square request to ${path} failed.`;
    throw new RequestError(message, response.status === 401 ? 502 : 400);
  }
  return body;
}

async function fetchRecentOrders(accessToken: string, locationId: string, sinceIso: string) {
  const body = await fetchSquare("/v2/orders/search", accessToken, {
    method: "POST",
    body: JSON.stringify({
      limit: 20,
      location_ids: [locationId],
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: sinceIso } },
          state_filter: { states: ["COMPLETED", "OPEN"] },
        },
        sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
      },
    }),
  });
  return body.orders || [];
}

function localParts(date: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(map.hour === "24" ? "0" : map.hour);
  const minute = Number(map.minute);
  return { dow: weekdayMap[map.weekday] ?? date.getUTCDay(), minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function computeLocationStatus(
  admin: AdminClient,
  accessToken: string,
  locationId: string,
  businessName: string,
) {
  const { data: business } = await admin.from("business_units").select("id").eq("name", businessName).maybeSingle();
  if (!business) return null;

  const { data: settings } = await admin
    .from("shop_presence_settings")
    .select("*")
    .eq("business_unit_id", business.id)
    .maybeSingle();

  const now = new Date();
  const timezone = settings?.timezone || "America/Toronto";
  const { dow, minutes: nowMinutes } = localParts(now, timezone);
  const hoursToday = settings?.open_hours?.[String(dow)];
  const openingGrace = Number(settings?.opening_grace_minutes ?? 10);
  const closingTolerance = Number(settings?.closing_early_tolerance_minutes ?? 15);

  const sinceIso = new Date(now.getTime() - (ACTIVITY_WINDOW_MINUTES + 5) * 60000).toISOString();
  let lastActivityAt: string | null = null;
  try {
    const orders = await fetchRecentOrders(accessToken, locationId, sinceIso);
    if (orders.length) {
      lastActivityAt = orders.map((o: Record<string, unknown>) => String(o.created_at)).sort().pop() || null;
    }
  } catch {
    // A Square hiccup should never break status computation; fall back to schedule-only.
  }
  const hasRecentActivity = Boolean(lastActivityAt);

  let status: string;
  if (!hoursToday) {
    status = "closed";
  } else {
    const openMinutes = toMinutes(hoursToday.open);
    const closeMinutes = toMinutes(hoursToday.close);

    if (nowMinutes < openMinutes - openingGrace) {
      status = "closed";
    } else if (nowMinutes < openMinutes + openingGrace) {
      status = hasRecentActivity ? "open" : "opening";
    } else if (nowMinutes <= closeMinutes - closingTolerance) {
      status = "open";
    } else if (nowMinutes <= closeMinutes + closingTolerance) {
      status = hasRecentActivity ? "open" : "closing";
    } else if (nowMinutes <= closeMinutes + closingTolerance + 90) {
      status = hasRecentActivity ? "after_hours" : "closed";
    } else {
      status = "closed";
    }
  }

  return { businessId: business.id as string, status, hasRecentActivity, lastActivityAt };
}

async function authorizeSync(req: Request, admin: AdminClient) {
  const expectedWorkerToken = Deno.env.get("RTB_SYNC_WORKER_TOKEN") || "";
  const providedWorkerToken = req.headers.get("x-rtb-worker-token") || "";
  if (expectedWorkerToken && providedWorkerToken === expectedWorkerToken) return;
  await authorizeManager(req, admin, null, OPERATIONS_REQUIREMENT);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new RequestError("Method not allowed.", 405);

    const admin = getAdminClient();
    await authorizeSync(req, admin);

    const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
    if (!accessToken) throw new RequestError("SQUARE_ACCESS_TOKEN Supabase secret is not set.", 500);

    const results: Record<string, unknown>[] = [];

    for (const [locationId, businessName] of Object.entries(LOCATIONS)) {
      const computed = await computeLocationStatus(admin, accessToken, locationId, businessName);
      if (!computed) {
        results.push({ businessName, skipped: true, reason: "business_unit not found" });
        continue;
      }

      const { data: latest } = await admin
        .from("shop_status_events")
        .select("status,created_at")
        .eq("business_unit_id", computed.businessId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const ageMs = latest ? Date.now() - new Date(latest.created_at as string).getTime() : Infinity;
      const stale = ageMs > STALE_AFTER_MS;
      const changed = !latest || latest.status !== computed.status;

      if (changed || stale) {
        const note = computed.hasRecentActivity
          ? `Auto-detected from Square activity (last sale ${computed.lastActivityAt}).`
          : `Auto-detected from schedule (no Square activity in the last ${ACTIVITY_WINDOW_MINUTES} min).`;

        const { error } = await admin.from("shop_status_events").insert({
          business_unit_id: computed.businessId,
          status: computed.status,
          staff_id: null,
          note,
        });
        if (error) throw error;
        results.push({ businessName, status: computed.status, inserted: true, reason: changed ? "changed" : "stale_refresh" });
      } else {
        results.push({ businessName, status: computed.status, inserted: false });
      }
    }

    return jsonResponse({ at: new Date().toISOString(), results });
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse({ error: err instanceof Error ? err.message : "Shop status auto sync failed." }, status);
  }
});
