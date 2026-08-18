import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function secretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) return "";
  const parsed = JSON.parse(raw);
  return parsed.default || Object.values(parsed)[0] || "";
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL") || "", secretKey(), { auth: { persistSession: false } });
}

function envName(provider: string, suffix: string) {
  return `INTEGRATION_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;
}

function page(title: string, message: string, ok = false) {
  const appUrl = Deno.env.get("RTB_OS_PUBLIC_URL") || Deno.env.get("SITE_URL") || "https://rtbheadquaters.com/";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{background:#08090d;color:#f7f3e8;font-family:Inter,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}main{max-width:560px;background:#12151d;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:24px}h1{color:${ok ? "#8fe3a2" : "#f1c768"}}p{color:#a7adba;line-height:1.55}a{color:#f1c768}</style></head><body><main><h1>${title}</h1><p>${message}</p><p><a href="${appUrl}">Return to Ricko OS</a></p></main></body></html>`;
}

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    const oauthError = url.searchParams.get("error") || "";
    if (oauthError) return html(page("Connection cancelled", oauthError), 400);
    if (!state || !code) return html(page("Connection failed", "The OAuth callback was missing a code or state."), 400);

    const admin = adminClient();
    const { data: oauthState, error: stateError } = await admin
      .from("integration_oauth_states")
      .select("*")
      .eq("state", state)
      .is("consumed_at", null)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();
    if (stateError) throw stateError;
    if (!oauthState) return html(page("Connection expired", "Start the connection again from Ricko OS."), 400);

    const provider = String(oauthState.provider || "").toLowerCase();
    if (provider === "square") return html(page("Use Square connection", "Square uses its dedicated secure callback. Start Square again from Ricko OS."), 400);

    const clientId = Deno.env.get(envName(provider, "CLIENT_ID")) || "";
    const clientSecret = Deno.env.get(envName(provider, "CLIENT_SECRET")) || "";
    const tokenUrl = Deno.env.get(envName(provider, "TOKEN_URL")) || "";
    const redirectUrl = Deno.env.get(envName(provider, "REDIRECT_URL")) || `${Deno.env.get("SUPABASE_URL")}/functions/v1/integration-oauth-callback`;
    if (!clientId || !clientSecret || !tokenUrl) throw new Error(`${provider} OAuth server configuration is incomplete.`);

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUrl,
      }),
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || token.error || `${provider} token exchange failed.`);

    const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : null;
    const scopeText = Array.isArray(token.scope) ? token.scope : String(token.scope || "");
    const scopes = Array.isArray(scopeText) ? scopeText : scopeText.split(/[ ,]+/).filter(Boolean);
    const row = {
      provider,
      business_unit_id: oauthState.business_unit_id || null,
      status: "connected",
      connection_type: "oauth",
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      token_type: token.token_type || "bearer",
      scopes,
      expires_at: expiresAt,
      metadata: { connectedAt: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    };

    let existingQuery = admin.from("integration_connections").select("id").eq("provider", provider);
    existingQuery = oauthState.business_unit_id ? existingQuery.eq("business_unit_id", oauthState.business_unit_id) : existingQuery.is("business_unit_id", null);
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing?.id) {
      const { error } = await admin.from("integration_connections").update(row).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await admin.from("integration_connections").insert(row);
      if (error) throw error;
    }

    await admin.from("integration_oauth_states").update({ consumed_at: new Date().toISOString() }).eq("id", oauthState.id);
    return html(page(`${provider} connected`, "The connection is active. Ricko OS can now use the permissions you approved.", true));
  } catch (error) {
    return html(page("Connection failed", error.message || "OAuth connection failed."), 400);
  }
});
