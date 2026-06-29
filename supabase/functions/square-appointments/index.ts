import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SQUARE_API_BASE = "https://connect.squareup.com";
const SQUARE_OAUTH_BASE = "https://connect.squareup.com/oauth2";
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") || "2026-05-20";
const SYNC_USAGE_KEY = "square_sync_usage";
const MAX_SQUARE_RANGE_DAYS = 31;
const DIRECT_TOKEN_SETUP_MESSAGE =
  "Add SQUARE_ACCESS_TOKEN as a Supabase Edge Function secret, then run Sync Square.";
const OAUTH_SETUP_MESSAGE =
  "Square OAuth secrets are missing. Add SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET, or use SQUARE_ACCESS_TOKEN for manual sync.";
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

class RequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

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
    throw new Error(OAUTH_SETUP_MESSAGE);
  }

  return { applicationId, applicationSecret, redirectUrl };
}

function hasSquareOAuthConfig(requireSecret = false) {
  const applicationId = Deno.env.get("SQUARE_APPLICATION_ID");
  const applicationSecret = Deno.env.get("SQUARE_APPLICATION_SECRET");
  const redirectUrl =
    Deno.env.get("SQUARE_REDIRECT_URL") ||
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/square-oauth-callback`;

  return Boolean(applicationId && redirectUrl && (!requireSecret || applicationSecret));
}

function getDirectSquareConnection() {
  const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
  if (!accessToken) return null;

  return {
    access_token: accessToken,
    expires_at: null,
    merchant_id: Deno.env.get("SQUARE_MERCHANT_ID") || "production_access_token",
    refresh_token: null,
    status: "direct_token",
  };
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(Deno.env.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getSyncLimits() {
  return {
    dailyLimit: numberFromEnv("SQUARE_SYNC_DAILY_LIMIT", 4),
    maxBookings: numberFromEnv("SQUARE_SYNC_MAX_BOOKINGS", 500),
    minIntervalMinutes: numberFromEnv("SQUARE_SYNC_MIN_INTERVAL_MINUTES", 360),
  };
}

function moneyToNumber(amount?: number) {
  return Number(((amount || 0) / 100).toFixed(2));
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(value),
  );
}

function parseDateInput(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDefaultPeriod() {
  const now = new Date();
  const end = now;
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 30);
  return { end, start };
}

function getPeriod(body: Record<string, any> = {}) {
  const providedStart = parseDateInput(body.start_date || body.startDate);
  const providedEnd = parseDateInput(body.end_date || body.endDate);

  if (providedStart && providedEnd && providedStart < providedEnd) {
    return {
      end: providedEnd,
      start: providedStart,
    };
  }

  return getDefaultPeriod();
}

function splitIntoSquareRanges(start: Date, end: Date) {
  const ranges: { start: Date; end: Date }[] = [];
  let cursor = new Date(start);

  while (cursor < end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_SQUARE_RANGE_DAYS);
    chunkEnd.setUTCMilliseconds(chunkEnd.getUTCMilliseconds() - 1);
    ranges.push({
      end: chunkEnd < end ? chunkEnd : new Date(end),
      start: new Date(cursor),
    });
    cursor = new Date(chunkEnd);
    cursor.setUTCMilliseconds(cursor.getUTCMilliseconds() + 1);
  }

  return ranges;
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

async function authorizeRequest(
  req: Request,
  admin: ReturnType<typeof createClient>,
  businessUnitId: string,
) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new RequestError("Sign in to manage Square Appointments.", 401);
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    throw new RequestError("Your session is invalid or expired.", 401);
  }

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("active,business_unit_id,role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  const canManage =
    profile?.active === true &&
    (
      profile.role === "admin" ||
      (
        profile.role === "manager" &&
        (!profile.business_unit_id || profile.business_unit_id === businessUnitId)
      )
    );

  if (!canManage) {
    throw new RequestError("Admin or assigned manager access is required.", 403);
  }
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

async function fetchAllBookings(accessToken: string, start: Date, end: Date, maxBookings: number) {
  const bookings: Record<string, unknown>[] = [];
  let cursor = "";
  let limited = false;

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
    limited = bookings.length > maxBookings || (Boolean(cursor) && bookings.length >= maxBookings);
  } while (cursor && bookings.length < maxBookings);

  return {
    bookings: bookings.slice(0, maxBookings),
    limited,
  };
}

async function fetchAllBookingsChunked(
  accessToken: string,
  start: Date,
  end: Date,
  maxBookings: number,
) {
  const allBookings: Record<string, unknown>[] = [];
  let limited = false;
  const ranges = splitIntoSquareRanges(start, end);

  for (const range of ranges) {
    if (allBookings.length >= maxBookings) {
      limited = true;
      break;
    }

    const remainingLimit = maxBookings - allBookings.length;
    const result = await fetchAllBookings(
      accessToken,
      range.start,
      range.end,
      remainingLimit,
    );
    allBookings.push(...result.bookings);

    if (result.limited) {
      limited = true;
      break;
    }
  }

  return {
    bookings: allBookings.slice(0, maxBookings),
    limited: limited || allBookings.length >= maxBookings,
  };
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
  const periodLabel = `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;

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
      periodLabel,
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
  if (!data) {
    const directConnection = getDirectSquareConnection();
    if (directConnection) return directConnection;
    throw new Error(`Square is not connected yet. ${DIRECT_TOKEN_SETUP_MESSAGE}`);
  }

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  const fiveMinutes = 5 * 60 * 1000;

  if (data.refresh_token && expiresAt && expiresAt - Date.now() < fiveMinutes) {
    return refreshSquareToken(admin, data);
  }

  return data;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

async function getSyncBudget(admin: ReturnType<typeof createClient>) {
  const limits = getSyncLimits();
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", SYNC_USAGE_KEY)
    .maybeSingle();

  if (error) throw error;

  const usage = data?.value || {};
  const lastSyncAt = usage.lastSyncAt ? new Date(usage.lastSyncAt).getTime() : 0;
  const minIntervalMs = limits.minIntervalMinutes * 60 * 1000;

  if (lastSyncAt && Date.now() - lastSyncAt < minIntervalMs) {
    const nextSyncAt = new Date(lastSyncAt + minIntervalMs).toISOString();
    return {
      allowed: false,
      limits,
      message: `Square already synced recently. Try again after ${nextSyncAt}.`,
      nextSyncAt,
      usage,
    };
  }

  const daily = usage.daily?.date === todayKey()
    ? usage.daily
    : { count: 0, date: todayKey() };

  if (Number(daily.count || 0) >= limits.dailyLimit) {
    const nextSyncAt = nextUtcDay();
    return {
      allowed: false,
      limits,
      message: `Square sync limit reached for today. Try again after ${nextSyncAt}.`,
      nextSyncAt,
      usage: { ...usage, daily },
    };
  }

  return {
    allowed: true,
    daily,
    limits,
    nextSyncAt: null,
    usage: { ...usage, daily },
  };
}

async function recordSyncUsage(
  admin: ReturnType<typeof createClient>,
  budget: Record<string, unknown>,
  bookingsSynced: number,
  limited: boolean,
) {
  const now = new Date().toISOString();
  const daily = budget.daily as { count?: number; date?: string } | undefined;
  const value = {
    ...(budget.usage as Record<string, unknown> || {}),
    daily: {
      count: Number(daily?.count || 0) + 1,
      date: daily?.date || todayKey(),
    },
    lastBookingsSynced: bookingsSynced,
    lastLimitedSync: limited,
    lastSyncAt: now,
    limits: budget.limits,
    nextSyncAt: new Date(new Date(now).getTime() + Number((budget.limits as { minIntervalMinutes?: number }).minIntervalMinutes || 0) * 60 * 1000).toISOString(),
  };

  await admin.from("app_settings").upsert({
    key: SYNC_USAGE_KEY,
    updated_at: now,
    value,
  });

  return value;
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
    await authorizeRequest(req, admin, businessUnit.id);

    if (businessUnit.name !== "RTB Beauty Lounge") {
      return jsonResponse({ error: "Square Appointments is only configured for RTB Beauty Lounge." }, 400);
    }

    if (action === "start") {
      const directConnection = getDirectSquareConnection();
      if (directConnection && !hasSquareOAuthConfig(false)) {
        return jsonResponse({
          directToken: true,
          error: "Square is already set up for production-token sync. Use Sync Square instead of OAuth Connect.",
        }, 409);
      }

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
      const directConnection = getDirectSquareConnection();
      const budget = await getSyncBudget(admin);
      const daily = budget.usage?.daily || {};
      const oauthConfigured = hasSquareOAuthConfig(true);
      return jsonResponse({
        connected: Boolean(data || directConnection),
        connection: data || (directConnection
          ? {
            expires_at: null,
            merchant_id: directConnection.merchant_id,
            status: directConnection.status,
            updated_at: null,
          }
          : null),
        limits: getSyncLimits(),
        setup: {
          directTokenConfigured: Boolean(directConnection),
          message: directConnection
            ? "Production token sync ready."
            : data
              ? "Square OAuth connection saved."
              : DIRECT_TOKEN_SETUP_MESSAGE,
          mode: directConnection ? "direct_token" : data ? "oauth" : "missing",
          oauthConfigured,
        },
        sync: {
          allowed: budget.allowed,
          dailyCount: Number(daily.count || 0),
          nextSyncAt: budget.nextSyncAt,
        },
      });
    }

    if (action === "sync") {
      const budget = await getSyncBudget(admin);
      if (!budget.allowed) {
        return jsonResponse({
          bookingsSynced: 0,
          limits: budget.limits,
          message: budget.message,
          nextSyncAt: budget.nextSyncAt,
          skipped: true,
        });
      }

      const connection = await getValidSquareConnection(admin, businessUnit.id);
      const { start, end } = getPeriod(body);
      const { bookings, limited } = await fetchAllBookingsChunked(
        String(connection.access_token),
        start,
        end,
        budget.limits.maxBookings,
      );
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
      const usage = await recordSyncUsage(admin, budget, bookings.length, limited);

      return jsonResponse({
        bookingsSynced: bookings.length,
        limited,
        limits: budget.limits,
        message: limited
          ? `Square synced the first ${budget.limits.maxBookings} bookings to stay inside the usage cap.`
          : "Square sync complete.",
        nextSyncAt: usage.nextSyncAt,
        updatedAt: dashboard.updatedAt,
      });
    }

    return jsonResponse({ error: "Unknown action." }, 400);
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 400;
    return jsonResponse({ error: err.message || "Square request failed." }, status);
  }
});
