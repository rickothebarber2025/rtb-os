import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-rtb-worker-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

export class RequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

export async function readJson(req: Request) {
  try {
    return await req.json();
  } catch (_err) {
    return {};
  }
}

export function getSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) return "";

  const parsed = JSON.parse(secretKeys);
  return parsed.default || Object.values(parsed)[0] || "";
}

export function getAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = getSecretKey();

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase function secrets are missing.");
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

export function getSiteUrl() {
  return (
    Deno.env.get("RTB_OS_PUBLIC_URL") ||
    Deno.env.get("SITE_URL") ||
    Deno.env.get("APP_URL") ||
    "https://rtbheadquaters.com"
  ).replace(/\/+$/, "");
}

export function getSurveyUrl(token: string) {
  return `${getSiteUrl()}/survey/${encodeURIComponent(token)}`;
}

export function cleanText(value: unknown, fallback = "") {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text || fallback;
}

export function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeIssueKey(value: string) {
  return cleanText(value, "general")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "general";
}

export function getBearerToken(req: Request) {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
}

const OWNER_EMAIL = "rickothebarber@gmail.com";
const ALL_BUSINESSES_ACCESS = "all-businesses";
const MODULE_IDS = [
  "dashboard",
  "roster",
  "payroll",
  "performance",
  "appointments",
  "booth_rent",
  "operations",
  "access",
  "settings",
];

function normalizePermission(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function normalizePermissionsPayload(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const source = raw.modules && typeof raw.modules === "object"
    ? raw.modules as Record<string, unknown>
    : raw;
  return Object.fromEntries(
    MODULE_IDS.map((moduleId) => {
      const level = normalizePermission(source[moduleId]);
      return [moduleId, ["none", "view", "edit", "admin"].includes(level) ? level : "none"];
    }),
  );
}

function getBusinessAccess(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const businessUnitIds = Array.isArray(raw.business_unit_ids)
    ? [...new Set(raw.business_unit_ids.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];

  return {
    all:
      raw.business_scope === "all" ||
      businessUnitIds.includes(ALL_BUSINESSES_ACCESS),
    ids: businessUnitIds.filter((id) => id !== ALL_BUSINESSES_ACCESS),
  };
}

function legacyPermission(profile: { role?: string | null } | null, moduleId: string) {
  const role = String(profile?.role || "").trim().toLowerCase();
  if (role === "admin" || role === "owner") return "admin";
  if (role === "manager") {
    if (moduleId === "access") return "none";
    if (["dashboard", "payroll", "settings"].includes(moduleId)) return "view";
    return "edit";
  }
  if (role === "staff" && ["dashboard", "operations"].includes(moduleId)) return "view";
  return "none";
}

function hasAnyPermission(profile: { active?: boolean | null; email?: string | null; permissions?: unknown; role?: string | null } | null, minimum: string) {
  if (String(profile?.email || "").trim().toLowerCase() === OWNER_EMAIL) return true;
  if (!profile?.active) return false;

  const levels = ["none", "view", "edit", "admin"];
  const requiredLevel = levels.indexOf(minimum);
  const permissions = profile.permissions === null
    ? Object.fromEntries(MODULE_IDS.map((moduleId) => [moduleId, legacyPermission(profile, moduleId)]))
    : normalizePermissionsPayload(profile.permissions);

  return Object.values(permissions).some((permission) => {
    const currentLevel = levels.indexOf(normalizePermission(permission));
    return currentLevel >= requiredLevel;
  });
}

export async function authorizeManager(
  req: Request,
  admin: ReturnType<typeof createClient>,
  businessId?: string | null,
) {
  const token = getBearerToken(req);
  if (!token) throw new RequestError("Sign in to manage customer intelligence.", 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    throw new RequestError("Your session is invalid or expired.", 401);
  }

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("active,business_unit_id,email,permissions,role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  const businessAccess = getBusinessAccess(profile?.permissions);
  const canAccessBusiness =
    !businessId ||
    String(profile?.email || "").trim().toLowerCase() === OWNER_EMAIL ||
    businessAccess.all ||
    businessAccess.ids.includes(String(businessId)) ||
    profile?.business_unit_id === businessId;
  const canManage = hasAnyPermission(profile, "edit") && canAccessBusiness;

  if (!canManage) {
    throw new RequestError("Admin or assigned manager access is required.", 403);
  }

  return { profile, user: authData.user };
}

export function maxBatchSize(value: unknown, fallback = 5, max = 25) {
  const requested = numberValue(value, fallback);
  return Math.max(1, Math.min(max, Math.floor(requested)));
}
