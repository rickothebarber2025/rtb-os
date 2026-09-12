import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-rtb-home-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeys) return "";

  try {
    const parsed = JSON.parse(secretKeys);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = getSecretKey();
  if (!url || !key) throw new Error("Supabase service credentials are unavailable.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function authorize(req: Request, admin: ReturnType<typeof createClient>, businessUnitId: string | null) {
  const configuredSecret = Deno.env.get("GOOGLE_HOME_WEBHOOK_SECRET") || "";
  const suppliedSecret = req.headers.get("x-rtb-home-secret") || "";

  if (configuredSecret && suppliedSecret && suppliedSecret === configuredSecret) {
    return { mode: "webhook" };
  }

  const authorization = req.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) {
    throw new Error(
      configuredSecret
        ? "Unauthorized."
        : "Google Home webhook secret is not configured. Add GOOGLE_HOME_WEBHOOK_SECRET or sign in as an RTB OS admin.",
    );
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid or expired session.");

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("active,role,business_unit_id,permissions,email")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  const owner = String(profile?.email || "").toLowerCase() === "rickothebarber@gmail.com";
  const modulePermission = String(profile?.permissions?.modules?.operations || profile?.permissions?.operations || "none");
  const isAdmin = owner || profile?.role === "admin" || modulePermission === "admin";
  const businessAllowed =
    owner ||
    profile?.role === "admin" ||
    !businessUnitId ||
    !profile?.business_unit_id ||
    profile.business_unit_id === businessUnitId;

  if (!profile?.active || !isAdmin || !businessAllowed) {
    throw new Error("Operations admin access is required.");
  }

  return { mode: "user", userId: data.user.id };
}

function normalizeEventType(value: unknown) {
  const type = String(value || "").toLowerCase();
  if (["person", "motion", "door", "manual"].includes(type)) return type;
  if (type.includes("person")) return "person";
  if (type.includes("door")) return "door";
  if (type.includes("motion")) return "motion";
  return "motion";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const admin = adminClient();
    const businessUnitId = body.businessUnitId || body.business_unit_id || null;

    await authorize(req, admin, businessUnitId);

    const eventType = normalizeEventType(body.eventType || body.event_type || body.type);
    const occurredAt = body.occurredAt || body.occurred_at || body.timestamp || new Date().toISOString();
    const parsedDate = new Date(occurredAt);
    if (Number.isNaN(parsedDate.getTime())) return response({ error: "Invalid occurredAt timestamp." }, 400);

    if (businessUnitId) {
      const { data: unit, error: unitError } = await admin
        .from("business_units")
        .select("id,name")
        .eq("id", businessUnitId)
        .maybeSingle();
      if (unitError) throw unitError;
      if (!unit) return response({ error: "Unknown business unit." }, 400);
    }

    const payload = {
      business_unit_id: businessUnitId,
      confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : null,
      device_name: body.deviceName || body.device_name || body.camera || null,
      event_type: eventType,
      external_event_id: body.externalEventId || body.external_event_id || body.id || null,
      metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
      occurred_at: parsedDate.toISOString(),
      source: body.source || "google_home",
    };

    const query = admin.from("shop_presence_events").insert(payload).select("*").single();
    const { data, error } = await query;

    if (error) {
      if (error.code === "23505") {
        return response({ duplicate: true, message: "Event already recorded." }, 200);
      }
      throw error;
    }

    return response({
      event: data,
      message: "Shop activity recorded.",
    });
  } catch (error) {
    return response({ error: error?.message || "Unable to record shop activity." }, 401);
  }
});
