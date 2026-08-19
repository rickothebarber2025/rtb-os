import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_EMAIL = Deno.env.get("RTB_OWNER_EMAIL") || "rickothebarber@gmail.com";
const APP_URL = Deno.env.get("RTB_OS_PUBLIC_URL") || Deno.env.get("SITE_URL") || "https://rtbheadquaters.com/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function secretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) return "";
  const parsed = JSON.parse(raw);
  return parsed.default || Object.values(parsed)[0] || "";
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") || "", secretKey(), {
    auth: { persistSession: false },
  });
}

async function requireOwner(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Authentication required.");
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error("Authentication required.");
  if (String(data.user.email || "").toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    throw new Error("Owner access required.");
  }
  return { admin, user: data.user };
}

function envName(provider: string, suffix: string) {
  return `INTEGRATION_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;
}

function genericOAuthConfig(provider: string) {
  const clientId = Deno.env.get(envName(provider, "CLIENT_ID")) || "";
  const authorizeUrl = Deno.env.get(envName(provider, "AUTHORIZE_URL")) || "";
  const scopes = (Deno.env.get(envName(provider, "SCOPES")) || "")
    .split(/[ ,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const redirectUrl = Deno.env.get(envName(provider, "REDIRECT_URL")) ||
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-oauth-callback`;
  return { authorizeUrl, clientId, redirectUrl, scopes };
}

function squareOAuthConfig() {
  return {
    authorizeUrl: "https://connect.squareup.com/oauth2/authorize",
    clientId: Deno.env.get("SQUARE_APPLICATION_ID") || "",
    redirectUrl: Deno.env.get("SQUARE_REDIRECT_URL") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/square-oauth-callback`,
    scopes: ["APPOINTMENTS_READ", "CUSTOMERS_READ", "MERCHANT_PROFILE_READ", "PAYMENTS_READ", "ORDERS_READ"],
  };
}

function safeConnection(row: Record<string, unknown>) {
  return {
    id: row.id,
    provider: row.provider,
    business_unit_id: row.business_unit_id,
    status: row.status,
    merchant_id: row.merchant_id,
    scopes: row.scopes || [],
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    account_name: (row.metadata as Record<string, unknown> | null)?.account_name || null,
    last_error: (row.metadata as Record<string, unknown> | null)?.last_error || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { admin } = await requireOwner(req);
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const action = String(body.action || "list");
    const provider = String(body.provider || "").trim().toLowerCase();
    const businessUnitId = body.businessUnitId || null;

    if (action === "list") {
      const { data, error } = await admin
        .from("integration_connections")
        .select("id, provider, business_unit_id, status, merchant_id, scopes, metadata, expires_at, created_at, updated_at")
        .order("provider");
      if (error) throw error;
      return json({ connections: (data || []).map(safeConnection) });
    }

    if (!provider) throw new Error("Provider is required.");

    if (action === "disconnect") {
      let query = admin.from("integration_connections").delete().eq("provider", provider);
      query = businessUnitId ? query.eq("business_unit_id", businessUnitId) : query.is("business_unit_id", null);
      const { error } = await query;
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "test") {
      let query = admin
        .from("integration_connections")
        .select("status, expires_at, updated_at, metadata")
        .eq("provider", provider);
      query = businessUnitId ? query.eq("business_unit_id", businessUnitId) : query.is("business_unit_id", null);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return json({ message: `${provider} is not connected.` });
      const expired = data.expires_at && new Date(data.expires_at).getTime() <= Date.now();
      if (expired) {
        await admin
          .from("integration_connections")
          .update({ status: "reauthorize", updated_at: new Date().toISOString() })
          .eq("provider", provider);
        return json({ message: `${provider} needs reauthorization.` });
      }
      return json({ message: `${provider} connection is ${data.status || "connected"}.` });
    }

    if (action === "begin_connect") {
      const apiKeyProviders = new Set(["jotform", "openai", "base44", "cloudflare", "metricool", "twilio", "resend"]);
      if (apiKeyProviders.has(provider)) {
        return json({
          mode: "api_key",
          message: `${provider} uses a server-side credential. Ricko OS will never expose that credential back to the browser.`,
        });
      }

      const config = provider === "square" ? squareOAuthConfig() : genericOAuthConfig(provider);
      if (!config.clientId || !config.authorizeUrl) {
        return json({
          mode: "setup_required",
          message: `${provider} is available in Ricko OS, but its OAuth application credentials still need to be configured on the server.`,
        });
      }

      const state = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error: stateError } = await admin.from("integration_oauth_states").insert({
        provider,
        business_unit_id: businessUnitId,
        state,
        expires_at: expiresAt,
        metadata: { app_url: APP_URL },
      });
      if (stateError) throw stateError;

      const url = new URL(config.authorizeUrl);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUrl);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", state);
      if (config.scopes.length) url.searchParams.set("scope", config.scopes.join(" "));
      if (provider === "google") {
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");
      }
      return json({ authorizationUrl: url.toString(), mode: "oauth" });
    }

    throw new Error("Unsupported integration action.");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Integration request failed." }, 400);
  }
});
