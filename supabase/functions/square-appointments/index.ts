import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SQUARE_API_BASE = "https://connect.squareup.com";
const SQUARE_OAUTH_BASE = "https://connect.squareup.com/oauth2";
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") || "2026-05-20";
const SCOPES = [
  "APPOINTMENTS_READ",
  "APPOINTMENTS_ALL_READ",
  "APPOINTMENTS_BUSINESS_SETTINGS_READ",
  "CUSTOMERS_READ",
  "ITEMS_READ",
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
  "ORDERS_READ",
];

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function getSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) return "";

  const parsed = JSON.parse(secretKeys);
  return parsed.default || Object.values(parsed)[0] || "";
}

function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getSecretKey();

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase function secrets are missing.");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function getSquareConfig(requireSecret = false) {
  const applicationId = Deno.env.get("SQUARE_APPLICATION_ID");
  const applicationSecret = Deno.env.get("SQUARE_APPLICATION_SECRET");
  const redirectUrl =
    Deno.env.get("SQUARE_REDIRECT_URL") ||
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/square-oauth-callback`;

  if (!applicationId || !redirectUrl || (requireSecret && !applicationSecret)) {
    throw new Error("Square function secrets are missing.");
  }

  return { applicationId, applicationSecret, redirectUrl };
}

function addMonths(date: Date, months: number) {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function moneyToNumber(amount?: number) {
  return Number(((amount || 0) / 100).toFixed(2));
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(value),
  );
}

function getPeriod() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0));
  const end = addMonths(start, 12);
  return { end, start };
}

async function getBusinessUnit(admin: ReturnType<typeof createClient>, businessUnitId?: string) {
  let query = admin.from("business_units").select("id,name").eq("name", "RTB Beauty Lounge");

  if (businessUnitId) {
    query = admin.from("business_units").select("id,name").eq("id", businessUnitId);
  }

  const { data, error } = await query.single();
  if (error) throw error;
  return data;
}

async function fetchSquare(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`${SQUARE_API_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
      ...(init.headers || {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body?.errors?.[0]?.detail || body?.errors?.[0]?.code || "Square API request failed.";
    throw new Error(message);
  }

  return body;
}

async function fetchAllBookings(accessToken: string, start: Date, end: Date) {
  const bookings: Record<string, unknown>[] = [];
  let cursor = "";

  do {
    const params = new URLSearchParams({
      limit: "100",
      start_at_max: end.toISOString(),
      start_at_min: start.toISOString(),
    });

    if (cursor) params.set("cursor", cursor);

    const body = await fetchSquare(`/v2/bookings?${params.toString()}`, accessToken);
    bookings.push(...(body.bookings || []));
    cursor = body.cursor || "";
  } while (cursor);

  return bookings;
}

async function fetchCatalog(accessToken: string, ids: string[]) {
  if (!ids.length) return new Map<string, { amount: number; name: string }>();

  const body = await fetchSquare("/v2/catalog/batch-retrieve", accessToken, {
    body: JSON.stringify({
      include_related_objects: true,
      object_ids: ids.slice(0, 1000),
    }),
    method: "POST",
  });

  const relatedItems = new Map<string, string>();
  for (const object of body.related_objects || []) {
    if (object.type === "ITEM") {
      relatedItems.set(object.id, object.item_data?.name || "Square service");
    }
  }

  const catalog = new Map<string, { amount: number; name: string }>();
  for (const object of body.objects || []) {
    if (object.type !== "ITEM_VARIATION") continue;
    const variation = object.item_variation_data || {};
    const itemName = relatedItems.get(variation.item_id) || "Square service";
    const variationName = variation.name && variation.name !== itemName ? ` - ${variation.name}` : "";
    catalog.set(object.id, {
      amount: Number(variation.price_money?.amount || 0),
      name: `${itemName}${variationName}`,
    });
  }

  return catalog;
}

async function fetchTeamProfiles(accessToken: string) {
  try {
    const body = await fetchSquare("/v2/bookings/team-member-booking-profiles?limit=100", accessToken);
    const profiles = new Map<string, string>();

    for (const profile of body.team_member_booking_profiles || []) {
      profiles.set(
        profile.team_member_id,
        profile.display_name || profile.team_member_id || "Square staff",
      );
    }

    return profiles;
  } catch (_err) {
    return new Map<string, string>();
  }
}

function getSegments(booking: Record<string, unknown>) {
  return Array.isArray(booking.appointment_segments)
    ? booking.appointment_segments as Record<string, unknown>[]
    : [];
}

function bookingAmount(booking: Record<string, unknown>, catalog: Map<string, { amount: number; name: string }>) {
  return getSegments(booking).reduce((total, segment) => {
    const serviceId = String(segment.service_variation_id || "");
    return total + Number(catalog.get(serviceId)?.amount || 0);
  }, 0);
}

function buildDashboard(
  bookings: Record<string, unknown>[],
  catalog: Map<string, { amount: number; name: string }>,
  teamProfiles: Map<string, string>,
  start: Date,
  end: Date,
) {
  const now = new Date();
  const monthly = new Map<string, { appointments: number; revenue: number }>();
  const staff = new Map<string, { appointments: number; mayAppointments: number; revenue: number }>();
  const services = new Map<string, { cancelled: number; count: number; revenue: number }>();
  const clients = new Map<string, { bookings: number; noShows: number; revenue: number }>();

  let canceled = 0;
  let completedAppointments = 0;
  let noShows = 0;
  let totalRevenueCents = 0;

  for (const booking of bookings) {
    const status = String(booking.status || "");
    const startAt = String(booking.start_at || booking.created_at || "");
    const isCanceled = status.toLowerCase().includes("cancel");
    const isNoShow = status.toLowerCase().includes("no_show");
    const amount = bookingAmount(booking, catalog);

    if (isCanceled) canceled += 1;
    if (isNoShow) noShows += 1;
    if (!isCanceled && new Date(startAt) <= now) completedAppointments += 1;
    if (!isCanceled) totalRevenueCents += amount;

    const month = monthLabel(startAt);
    const monthData = monthly.get(month) || { appointments: 0, revenue: 0 };
    monthData.appointments += 1;
    if (!isCanceled) monthData.revenue += amount;
    monthly.set(month, monthData);

    const clientId = String(booking.customer_id || "Unknown client");
    const client = clients.get(clientId) || { bookings: 0, noShows: 0, revenue: 0 };
    client.bookings += 1;
    client.noShows += isNoShow ? 1 : 0;
    client.revenue += amount;
    clients.set(clientId, client);

    for (const segment of getSegments(booking)) {
      const serviceId = String(segment.service_variation_id || "Unknown service");
      const teamId = String(segment.team_member_id || "Unknown staff");
      const service = services.get(serviceId) || { cancelled: 0, count: 0, revenue: 0 };
      const staffer = staff.get(teamId) || { appointments: 0, mayAppointments: 0, revenue: 0 };
      const segmentAmount = Number(catalog.get(serviceId)?.amount || 0);

      service.count += 1;
      service.cancelled += isCanceled ? 1 : 0;
      service.revenue += isCanceled ? 0 : segmentAmount;
      services.set(serviceId, service);

      staffer.appointments += 1;
      staffer.mayAppointments += month === "May" ? 1 : 0;
      staffer.revenue += isCanceled ? 0 : segmentAmount;
      staff.set(teamId, staffer);
    }
  }

  const monthOrder = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthlyRevenue = monthOrder
    .filter((month) => monthly.has(month))
    .map((month) => ({
      appointments: monthly.get(month)?.appointments || 0,
      month,
      partial: month === monthLabel(now.toISOString()),
      revenue: moneyToNumber(monthly.get(month)?.revenue),
    }));

  const staffRows = [...staff.entries()]
    .map(([id, row]) => ({
      appointments: row.appointments,
      color: "#C9A84C",
      mayAppointments: row.mayAppointments,
      name: teamProfiles.get(id) || `Square staff ${id.slice(-4)}`,
      occupancy: 0,
      revenue: moneyToNumber(row.revenue),
      visitTime: null,
      workHours: null,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const serviceRows = [...services.entries()]
    .map(([id, row]) => ({
      cancelRate: row.count ? Math.round((row.cancelled / row.count) * 100) : 0,
      cancelled: row.cancelled,
      count: row.count,
      fullName: catalog.get(id)?.name || id,
      name: catalog.get(id)?.name || `Square service ${id.slice(-4)}`,
      revenue: moneyToNumber(row.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const topClients = [...clients.entries()]
    .map(([id, row]) => ({
      bookings: row.bookings,
      name: id === "Unknown client" ? id : `Square customer ${id.slice(-4)}`,
      noShows: row.noShows,
      value: moneyToNumber(row.revenue),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const appointmentRows = bookings
    .map((booking) => {
      const segments = getSegments(booking);
      const firstSegment = segments[0] || {};
      const serviceId = String(firstSegment.service_variation_id || "");
      const teamId = String(firstSegment.team_member_id || "");
      return {
        amount: moneyToNumber(bookingAmount(booking, catalog)),
        client: booking.customer_id ? `Square customer ${String(booking.customer_id).slice(-4)}` : "Square client",
        date: new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(String(booking.start_at || booking.created_at))),
        service: catalog.get(serviceId)?.name || "Square service",
        staffer: teamProfiles.get(teamId) || "Square staff",
        startAt: String(booking.start_at || booking.created_at),
      };
    })
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const upcomingAppointments = appointmentRows.filter((row) => new Date(row.startAt) >= now).slice(0, 20);
  const recentTransactions = appointmentRows
    .filter((row) => new Date(row.startAt) < now)
    .reverse()
    .slice(0, 20);

  return {
    businessUnit: "RTB Beauty Lounge",
    clientSegments: [
      { appointments: completedAppointments, color: "#4CAF7D", count: completedAppointments, label: "Completed" },
      { appointments: upcomingAppointments.length, color: "#5B9BE0", count: upcomingAppointments.length, label: "Upcoming" },
      { appointments: canceled, color: "#E05252", count: canceled, label: "Canceled" },
    ],
    importedFrom: "Square Appointments API",
    location: "Square Appointments",
    monthlyRevenue,
    recentTransactions,
    services: serviceRows,
    source: "Square Appointments",
    staff: staffRows,
    summary: {
      allTimeBookings: bookings.length,
      allTimeClients: clients.size,
      completedAppointments,
      noShows,
      periodLabel: `${start.getUTCFullYear()} YTD`,
      revenueMode: "catalog_price_estimate",
      ytdRevenue: moneyToNumber(totalRevenueCents),
    },
    topClients,
    upcomingAppointments,
    updatedAt: new Date().toISOString(),
  };
}

async function refreshSquareToken(admin: ReturnType<typeof createClient>, connection: Record<string, unknown>) {
  const { applicationId, applicationSecret } = getSquareConfig(true);
  const response = await fetch(`${SQUARE_OAUTH_BASE}/token`, {
    body: JSON.stringify({
      client_id: applicationId,
      client_secret: applicationSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
    headers: {
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    method: "POST",
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.errors?.[0]?.detail || "Square token refresh failed.");
  }

  const { data, error } = await admin
    .from("integration_connections")
    .update({
      access_token: body.access_token,
      expires_at: body.expires_at || null,
      refresh_token: body.refresh_token || connection.refresh_token,
      token_type: body.token_type || "bearer",
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function getValidSquareConnection(admin: ReturnType<typeof createClient>, businessUnitId: string) {
  const { data, error } = await admin
    .from("integration_connections")
    .select("*")
    .eq("provider", "square")
    .eq("business_unit_id", businessUnitId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Square is not connected yet.");

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const fiveMinutes = 5 * 60 * 1000;

  if (data.refresh_token && expiresAt && expiresAt - Date.now() < fiveMinutes) {
    return refreshSquareToken(admin, data);
  }

  return data;
}

async function upsertSourceStatus(admin: ReturnType<typeof createClient>, status: string) {
  await admin.from("app_settings").upsert({
    key: "appointment_sources",
    updated_at: new Date().toISOString(),
    value: {
      "RTB Beauty Lounge": {
        lastSyncedAt: status === "loaded" ? new Date().toISOString() : null,
        settingKey: "rtb_beauty_square_appointments",
        source: "Square Appointments",
        status,
      },
      "RTB Lounge": {
        settingKey: "rtb_master_dashboard",
        source: "Booksy",
        status: "loaded",
      },
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const admin = getAdminClient();
    const body = await req.json().catch(() => ({}));
    const action = body.action || "status";
    const businessUnit = await getBusinessUnit(admin, body.businessUnitId);

    if (businessUnit.name !== "RTB Beauty Lounge") {
      return jsonResponse({ error: "Square Appointments is only configured for RTB Beauty Lounge." }, 400);
    }

    if (action === "start") {
      const { applicationId, redirectUrl } = getSquareConfig(false);
      const state = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      const { error } = await admin.from("integration_oauth_states").insert({
        business_unit_id: businessUnit.id,
        expires_at: expiresAt,
        metadata: { source: "rtb-os" },
        provider: "square",
        state,
      });

      if (error) throw error;

      const authorizationUrl = new URL(`${SQUARE_OAUTH_BASE}/authorize`);
      authorizationUrl.searchParams.set("client_id", applicationId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUrl);
      authorizationUrl.searchParams.set("scope", SCOPES.join(" "));
      authorizationUrl.searchParams.set("session", "false");
      authorizationUrl.searchParams.set("state", state);

      return jsonResponse({
        authorizationUrl: authorizationUrl.toString(),
        redirectUrl,
        scopes: SCOPES,
      });
    }

    if (action === "status") {
      const { data, error } = await admin
        .from("integration_connections")
        .select("merchant_id,status,expires_at,updated_at")
        .eq("provider", "square")
        .eq("business_unit_id", businessUnit.id)
        .maybeSingle();

      if (error) throw error;
      return jsonResponse({ connected: Boolean(data), connection: data || null });
    }

    if (action === "sync") {
      const connection = await getValidSquareConnection(admin, businessUnit.id);
      const { start, end } = getPeriod();
      const bookings = await fetchAllBookings(String(connection.access_token), start, end);
      const serviceIds = [
        ...new Set(
          bookings.flatMap((booking) =>
            getSegments(booking).map((segment) => String(segment.service_variation_id || "")).filter(Boolean)
          ),
        ),
      ];

      const [catalog, teamProfiles] = await Promise.all([
        fetchCatalog(String(connection.access_token), serviceIds),
        fetchTeamProfiles(String(connection.access_token)),
      ]);

      const dashboard = buildDashboard(bookings, catalog, teamProfiles, start, end);

      const { error } = await admin.from("app_settings").upsert({
        key: "rtb_beauty_square_appointments",
        updated_at: new Date().toISOString(),
        value: dashboard,
      });

      if (error) throw error;
      await upsertSourceStatus(admin, "loaded");

      return jsonResponse({
        bookingsSynced: bookings.length,
        updatedAt: dashboard.updatedAt,
      });
    }

    return jsonResponse({ error: "Unknown action." }, 400);
  } catch (err) {
    return jsonResponse({ error: err.message || "Square request failed." }, 400);
  }
});
