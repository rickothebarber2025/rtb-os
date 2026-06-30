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
    "https://rtb-os.netlify.app"
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
        (!businessId || !profile.business_unit_id || profile.business_unit_id === businessId)
      )
    );

  if (!canManage) {
    throw new RequestError("Admin or assigned manager access is required.", 403);
  }

  return { profile, user: authData.user };
}

export function maxBatchSize(value: unknown, fallback = 5, max = 25) {
  const requested = numberValue(value, fallback);
  return Math.max(1, Math.min(max, Math.floor(requested)));
}
