import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SQUARE_OAUTH_BASE = "https://connect.squareup.com/oauth2";
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") || "2026-05-20";
const OAUTH_SETUP_MESSAGE =
  "Square OAuth secrets are missing. Add SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET, or use SQUARE_ACCESS_TOKEN with Sync Square instead.";

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
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

function getSquareConfig() {
  const applicationId = Deno.env.get("SQUARE_APPLICATION_ID");
  const applicationSecret = Deno.env.get("SQUARE_APPLICATION_SECRET");
  const redirectUrl =
    Deno.env.get("SQUARE_REDIRECT_URL") ||
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/square-oauth-callback`;

  if (!applicationId || !applicationSecret || !redirectUrl) {
    throw new Error(OAUTH_SETUP_MESSAGE);
  }

  return { applicationId, applicationSecret, redirectUrl };
}

function page(title: string, message: string) {
  const appUrl =
    Deno.env.get("RTB_OS_PUBLIC_URL") ||
    Deno.env.get("SITE_URL") ||
    Deno.env.get("APP_URL") ||
    "https://rtbheadquaters.com/";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body {
        background: #08090d;
        color: #f7f3e8;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 8px;
        background: #12151d;
        max-width: 520px;
        padding: 24px;
      }
      h1 { color: #f1c768; margin: 0 0 10px; }
      p { color: #a7adba; line-height: 1.55; }
      a { color: #f1c768; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
      <p><a href="${appUrl}">Return to RTB OS</a></p>
    </main>
  </body>
</html>`;
}

async function exchangeCode(code: string) {
  const { applicationId, applicationSecret, redirectUrl } = getSquareConfig();
  const response = await fetch(`${SQUARE_OAUTH_BASE}/token`, {
    body: JSON.stringify({
      client_id: applicationId,
      client_secret: applicationSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUrl,
    }),
    headers: {
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    method: "POST",
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.errors?.[0]?.detail || "Square authorization failed.");
  }

  return body;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (error) {
      return htmlResponse(page("Square not connected", error), 400);
    }

    if (!code || !state) {
      return htmlResponse(page("Square not connected", "The Square callback was missing a code or state."), 400);
    }

    const admin = getAdminClient();
    const { data: oauthState, error: stateError } = await admin
      .from("integration_oauth_states")
      .select("*")
      .eq("provider", "square")
      .eq("state", state)
      .is("consumed_at", null)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();

    if (stateError) throw stateError;
    if (!oauthState) {
      return htmlResponse(page("Square not connected", "This Square connection link expired. Start again from RTB OS."), 400);
    }

    const token = await exchangeCode(code);
    const scopes = Array.isArray(token.scopes) ? token.scopes : [];

    const { error: upsertError } = await admin.from("integration_connections").upsert(
      {
        access_token: token.access_token,
        business_unit_id: oauthState.business_unit_id,
        expires_at: token.expires_at || null,
        merchant_id: token.merchant_id || null,
        metadata: { connectedAt: new Date().toISOString() },
        provider: "square",
        refresh_token: token.refresh_token || null,
        scopes,
        status: "connected",
        token_type: token.token_type || "bearer",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,business_unit_id" },
    );

    if (upsertError) throw upsertError;

    await admin
      .from("integration_oauth_states")
      .update({ consumed_at: new Date().toISOString() })
      .eq("state", state);

    await admin.from("app_settings").upsert({
      key: "appointment_sources",
      updated_at: new Date().toISOString(),
      value: {
        "RTB Beauty Lounge": {
          connectedAt: new Date().toISOString(),
          settingKey: "rtb_beauty_square_appointments",
          source: "Square Appointments",
          status: "connected",
        },
        "RTB Lounge": {
          settingKey: "rtb_master_dashboard",
          source: "Booksy",
          status: "loaded",
        },
      },
    });

    return htmlResponse(
      page(
        "Square connected",
        "RTB Beauty Lounge is connected to Square Appointments. Return to RTB OS and run Sync Square to load the latest data.",
      ),
    );
  } catch (err) {
    return htmlResponse(page("Square not connected", err.message || "Square authorization failed."), 400);
  }
});
