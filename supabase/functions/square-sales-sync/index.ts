import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  RequestError,
  authorizeManager,
  corsHeaders,
  getAdminClient,
  jsonResponse,
  readJson,
} from "../_shared/rtb.ts";

type AdminClient = ReturnType<typeof createClient>;

const SQUARE_API_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") || "2026-05-20";

// Same real location IDs confirmed earlier for the attendance sync.
const LOCATION_TO_BUSINESS_NAME: Record<string, string> = {
  "BYYR1W9SMFWS6": "RTB Lounge",
  "LJK9F49SHT4B0": "RTB Beauty Lounge",
};

const SALES_REQUIREMENTS = [
  { module: "operations", minimum: "edit" },
  { module: "performance", minimum: "edit" },
];

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

// "Net sales" here matches the same definition already used in
// payroll_entries.net_sales: what commission is calculated on, i.e. the
// order total minus tax and minus tip (confirmed against a real order:
// gross line items minus discounts equals total_money - tax_money -
// tip_money exactly).
function orderNetSales(order: Record<string, unknown>) {
  const net = (order.net_amounts as Record<string, Record<string, number>>) || {};
  const total = Number(net.total_money?.amount || 0);
  const tax = Number(net.tax_money?.amount || 0);
  const tip = Number(net.tip_money?.amount || 0);
  return (total - tax - tip) / 100;
}

async function fetchAllOrders(accessToken: string, locationId: string, startAt: string) {
  const orders: Record<string, unknown>[] = [];
  let cursor = "";

  do {
    const body = await fetchSquare("/v2/orders/search", accessToken, {
      body: JSON.stringify({
        cursor: cursor || undefined,
        limit: 200,
        location_ids: [locationId],
        query: {
          filter: {
            date_time_filter: { created_at: { start_at: startAt } },
            state_filter: { states: ["COMPLETED"] },
          },
          sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
        },
      }),
      method: "POST",
    });
    orders.push(...(body.orders || []));
    cursor = body.cursor || "";
  } while (cursor);

  return orders;
}

async function syncDailySales(admin: AdminClient, accessToken: string, days: number) {
  const { data: staffList, error: staffError } = await admin
    .from("staff")
    .select("id,square_team_member_id")
    .not("square_team_member_id", "is", null);
  if (staffError) throw staffError;

  const teamMemberToStaffId = new Map<string, string>(
    (staffList || []).map((row) => [row.square_team_member_id as string, row.id as string]),
  );

  const startAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let ordersProcessed = 0;
  let daysWritten = 0;
  const unmatchedTeamMembers = new Set<string>();

  for (const [locationId, businessName] of Object.entries(LOCATION_TO_BUSINESS_NAME)) {
    const { data: business } = await admin
      .from("business_units")
      .select("id")
      .eq("name", businessName)
      .maybeSingle();
    if (!business) continue;

    const orders = await fetchAllOrders(accessToken, locationId, startAt);
    const byDayAndMember = new Map<string, { netSales: number; orderCount: number }>();

    for (const order of orders) {
      const teamMemberId = String(order.created_by_team_member_id || "");
      if (!teamMemberId) continue;

      const createdAt = String(order.created_at || "");
      const saleDate = createdAt.slice(0, 10);
      if (!saleDate) continue;

      const key = `${saleDate}::${teamMemberId}`;
      const current = byDayAndMember.get(key) || { netSales: 0, orderCount: 0 };
      current.netSales += orderNetSales(order);
      current.orderCount += 1;
      byDayAndMember.set(key, current);
      ordersProcessed += 1;

      if (!teamMemberToStaffId.has(teamMemberId)) unmatchedTeamMembers.add(teamMemberId);
    }

    for (const [key, totals] of byDayAndMember.entries()) {
      const [saleDate, teamMemberId] = key.split("::");
      const staffId = teamMemberToStaffId.get(teamMemberId) || null;

      await admin.from("staff_daily_sales").upsert({
        business_unit_id: business.id,
        net_sales: totals.netSales,
        order_count: totals.orderCount,
        sale_date: saleDate,
        square_team_member_id: teamMemberId,
        staff_id: staffId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "business_unit_id,sale_date,square_team_member_id" });
      daysWritten += 1;
    }
  }

  return {
    daysWritten,
    ordersProcessed,
    unmatchedTeamMembers: unmatchedTeamMembers.size,
  };
}

async function authorizeSync(req: Request, admin: AdminClient, businessId: string | null) {
  const expectedWorkerToken = Deno.env.get("RTB_SYNC_WORKER_TOKEN") || "";
  const providedWorkerToken = req.headers.get("x-rtb-worker-token") || "";

  if (expectedWorkerToken && providedWorkerToken && providedWorkerToken === expectedWorkerToken) {
    return;
  }

  await authorizeManager(req, admin, businessId, SALES_REQUIREMENTS);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new RequestError("Method not allowed.", 405);

    const admin = getAdminClient();
    const body = await readJson(req);
    await authorizeSync(req, admin, body.businessId || null);

    const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
    if (!accessToken) {
      throw new RequestError("SQUARE_ACCESS_TOKEN Supabase secret is not set.", 500);
    }

    const days = Math.max(1, Math.min(60, Number(body.days) || 14));
    const result = await syncDailySales(admin, accessToken, days);

    return jsonResponse(result);
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Daily sales sync failed." },
      status,
    );
  }
});
