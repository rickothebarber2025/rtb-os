import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_EMAIL = Deno.env.get("RTB_OWNER_EMAIL") || "rickothebarber@gmail.com";
const APP_URL = Deno.env.get("RTB_OS_PUBLIC_URL") || Deno.env.get("SITE_URL") || "https://rtbheadquaters.com/";
const CALLBACK_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-oauth-callback`;
const API_KEY_PROVIDERS = new Set(["jotform", "openai", "base44", "cloudflare", "metricool", "twilio", "resend"]);
const SUPABASE_ACCOUNT_PROVIDERS = new Set(["google", "google_business"]);

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
  try {
    const parsed = JSON.parse(raw);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return raw;
  }
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") || "", secretKey(), {
    auth: { persistSession: false },
  });
}

async function requireOwner(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("AUTH_REQUIRED");
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Error("AUTH_REQUIRED");
  if (String(data.user.email || "").toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
    throw new Error("OWNER_REQUIRED");
  }
  return { admin, user: data.user };
}

function envName(provider: string, suffix: string) {
  return `INTEGRATION_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;
}

async function vaultCredential(admin: any, provider: string, businessUnitId: string | null, credentialKey: string) {
  const { data, error } = await admin.rpc("get_integration_credential", {
    p_provider: provider,
    p_business_unit_id: businessUnitId,
    p_credential_key: credentialKey,
  });
  if (error) return "";
  return String(data || "");
}

async function storeCredential(admin: any, provider: string, businessUnitId: string | null, key: string, value: string) {
  if (!value) return;
  const { error } = await admin.rpc("store_integration_credential", {
    p_provider: provider,
    p_business_unit_id: businessUnitId,
    p_credential_key: key,
    p_secret: value,
  });
  if (error) throw error;
}

async function credential(admin: any, provider: string, businessUnitId: string | null, key: string, envSuffix: string) {
  return Deno.env.get(envName(provider, envSuffix)) || await vaultCredential(admin, provider, businessUnitId, key);
}

async function genericOAuthConfig(admin: any, provider: string, businessUnitId: string | null) {
  const clientId = await credential(admin, provider, businessUnitId, "client_id", "CLIENT_ID");
  const authorizeUrl = await credential(admin, provider, businessUnitId, "authorize_url", "AUTHORIZE_URL");
  const scopesRaw = await credential(admin, provider, businessUnitId, "scopes", "SCOPES");
  const redirectUrl = await credential(admin, provider, businessUnitId, "redirect_url", "REDIRECT_URL") || CALLBACK_URL;
  const scopes = scopesRaw.split(/[ ,]+/).map((value) => value.trim()).filter(Boolean);
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
    connection_type: row.connection_type || null,
  };
}

async function findConnection(admin: any, provider: string, businessUnitId: string | null) {
  let query = admin.from("integration_connections").select("id").eq("provider", provider);
  query = businessUnitId ? query.eq("business_unit_id", businessUnitId) : query.is("business_unit_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertConnection(admin: any, provider: string, businessUnitId: string | null, row: Record<string, unknown>) {
  const existing = await findConnection(admin, provider, businessUnitId);
  const payload = { provider, business_unit_id: businessUnitId, ...row, updated_at: new Date().toISOString() };
  if (existing?.id) {
    const { error } = await admin.from("integration_connections").update(payload).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await admin.from("integration_connections").insert(payload);
    if (error) throw error;
  }
}

async function upsertConfiguredConnection(admin: any, provider: string, businessUnitId: string | null, connectionType: string) {
  await upsertConnection(admin, provider, businessUnitId, {
    status: connectionType === "api_key" ? "configured" : "setup_ready",
    connection_type: connectionType,
    metadata: { managed_by: "rtb_os", credential_vault: true },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { admin } = await requireOwner(req);
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));
    const requestedAction = String(body.action || "list").trim().toLowerCase();
    const action = requestedAction === "status" || requestedAction === "refresh" || requestedAction === "connections"
      ? "list"
      : requestedAction === "connect"
        ? "begin_connect"
        : requestedAction === "save"
          ? "save_setup"
          : requestedAction === "check"
            ? "test"
            : requestedAction;
    const provider = String(body.provider || "").trim().toLowerCase();
    const businessUnitId = body.businessUnitId || body.business_unit_id || null;

    if (action === "list") {
      const { data, error } = await admin
        .from("integration_connections")
        .select("id, provider, business_unit_id, status, connection_type, merchant_id, scopes, metadata, expires_at, created_at, updated_at")
        .order("provider");
      if (error) throw error;
      return json({ ok: true, connections: (data || []).map(safeConnection) });
    }

    if (!provider) return json({ ok: false, error: "Provider is required.", code: "PROVIDER_REQUIRED" });

    if (action === "capture_oauth_session") {
      if (!SUPABASE_ACCOUNT_PROVIDERS.has(provider)) {
        return json({ ok: false, error: "This provider does not support RTB OS account-login capture.", code: "UNSUPPORTED_PROVIDER" });
      }
      const accessToken = String(body.accessToken || "").trim();
      const refreshToken = String(body.refreshToken || "").trim();
      const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
      if (!accessToken) return json({ ok: false, error: "The provider did not return an access token. Reconnect and approve access.", code: "TOKEN_MISSING" });

      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileResponse.ok) {
        return json({ ok: false, error: "Google did not accept the returned account token. Reconnect and approve access.", code: "TOKEN_INVALID" });
      }
      const profile = await profileResponse.json().catch(() => ({}));
      await storeCredential(admin, provider, businessUnitId, "access_token", accessToken);
      if (refreshToken) await storeCredential(admin, provider, businessUnitId, "refresh_token", refreshToken);
      await upsertConnection(admin, provider, businessUnitId, {
        status: "connected",
        connection_type: "oauth",
        scopes,
        metadata: {
          managed_by: "rtb_os",
          credential_vault: true,
          account_name: profile.email || profile.name || "Google account",
          provider_user_id: profile.sub || null,
        },
      });
      return json({ ok: true, connected: true, accountName: profile.email || profile.name || "Google account", message: `${provider === "google_business" ? "Google Business Profile" : "Google Workspace"} connected.` });
    }

    if (action === "save_setup") {
      const credentials = body.credentials && typeof body.credentials === "object" ? body.credentials : {};
      const allowedKeys = API_KEY_PROVIDERS.has(provider)
        ? ["api_key"]
        : ["client_id", "client_secret", "authorize_url", "token_url", "redirect_url", "scopes"];
      let saved = 0;

      for (const key of allowedKeys) {
        const value = String(credentials[key] || "").trim();
        if (!value) continue;
        await storeCredential(admin, provider, businessUnitId, key, value);
        saved += 1;
      }

      if (!saved) return json({ ok: false, error: "Enter the connection details before saving.", code: "SETUP_REQUIRED" });
      await upsertConfiguredConnection(admin, provider, businessUnitId, API_KEY_PROVIDERS.has(provider) ? "api_key" : "oauth");
      return json({
        ok: true,
        mode: API_KEY_PROVIDERS.has(provider) ? "api_key" : "oauth",
        message: API_KEY_PROVIDERS.has(provider)
          ? "Credential saved securely in RTB OS."
          : "Connection setup saved securely. Continue to sign in with the provider.",
      });
    }

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
        .select("status, connection_type, expires_at, updated_at, metadata")
        .eq("provider", provider);
      query = businessUnitId ? query.eq("business_unit_id", businessUnitId) : query.is("business_unit_id", null);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return json({ ok: true, connected: false, message: `${provider} is not connected.` });
      const expired = data.expires_at && new Date(data.expires_at).getTime() <= Date.now();
      if (expired) {
        await admin.from("integration_connections").update({ status: "reauthorize", updated_at: new Date().toISOString() }).eq("provider", provider);
        return json({ ok: true, connected: false, message: `${provider} needs reauthorization.` });
      }
      if (data.status === "configured") return json({ ok: true, connected: true, message: `${provider} credential is stored securely in RTB OS.` });
      if (data.status === "setup_ready") return json({ ok: true, connected: false, message: `${provider} setup is ready. Sign in to finish connecting.` });
      return json({ ok: true, connected: data.status === "connected", message: `${provider} connection is ${data.status || "connected"}.` });
    }

    if (action === "begin_connect") {
      if (SUPABASE_ACCOUNT_PROVIDERS.has(provider)) {
        return json({ ok: true, mode: "account_login", accountLogin: true, message: "Sign in with your Google account to connect. RTB OS handles the app credentials behind the scenes." });
      }

      if (API_KEY_PROVIDERS.has(provider)) {
        const apiKey = await vaultCredential(admin, provider, businessUnitId, "api_key");
        if (!apiKey) {
          return json({
            ok: true,
            mode: "api_key",
            setupRequired: true,
            message: `Add the ${provider} credential once inside RTB OS. It will be encrypted and hidden after saving.`,
          });
        }
        await upsertConfiguredConnection(admin, provider, businessUnitId, "api_key");
        return json({ ok: true, mode: "api_key", configured: true, message: `${provider} is configured in RTB OS.` });
      }

      const config = provider === "square" ? squareOAuthConfig() : await genericOAuthConfig(admin, provider, businessUnitId);
      if (!config.clientId || !config.authorizeUrl) {
        return json({
          ok: true,
          mode: "managed_oauth",
          setupRequired: true,
          message: `${provider} needs one-time server setup by RTB OS before account sign-in is available. You do not need to enter a client ID or secret here.`,
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
      return json({ ok: true, authorizationUrl: url.toString(), mode: "oauth" });
    }

    return json({ ok: false, error: "That integration action is no longer supported. Refresh RTB OS and try again.", code: "UNSUPPORTED_ACTION" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Integration request failed.";
    if (message === "AUTH_REQUIRED") {
      return json({ ok: false, error: "Your RTB OS session expired. Refreshing your sign-in should fix this.", code: "AUTH_REQUIRED" });
    }
    if (message === "OWNER_REQUIRED") {
      return json({ ok: false, error: "Owner access is required to manage integrations.", code: "OWNER_REQUIRED" });
    }
    return json({ ok: false, error: message, code: "INTEGRATION_ERROR" });
  }
});
