import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const bridgeUrl = (Deno.env.get("TEXTNOW_BRIDGE_URL") || "").replace(/\/$/, "");
    const bridgeSecret = Deno.env.get("RTB_TEXTNOW_BRIDGE_SECRET") || "";
    if (!supabaseUrl || !serviceKey) return response({ error: "Supabase function secrets are missing." }, 500);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return response({ error: "Invalid session." }, 401);

    const { data: profile } = await admin
      .from("user_profiles")
      .select("email,active,permissions")
      .eq("id", authData.user.id)
      .maybeSingle();

    const owner = String(profile?.email || "").toLowerCase() === "rickothebarber@gmail.com";
    const messagesLevel = String(profile?.permissions?.modules?.messages || "none").toLowerCase();
    const allowed = owner || ["view", "edit", "admin"].includes(messagesLevel);
    if (!profile?.active || !allowed) return response({ error: "Messages access is not enabled for this account." }, 403);

    if (!bridgeUrl || !bridgeSecret) {
      return response({ connected: false, configured: false, error: "TextNow bridge is not configured yet." }, 503);
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "messages";
    let target = `${bridgeUrl}/messages?limit=${encodeURIComponent(url.searchParams.get("limit") || "100")}`;
    let method = "GET";
    let body: string | undefined;

    if (action === "health") target = `${bridgeUrl}/health`;
    if (action === "conversation") {
      const number = url.searchParams.get("number") || "";
      target = `${bridgeUrl}/messages/${encodeURIComponent(number)}?limit=${encodeURIComponent(url.searchParams.get("limit") || "100")}`;
    }
    if (action === "send") {
      method = "POST";
      target = `${bridgeUrl}/send-sms`;
      body = JSON.stringify(await req.json());
    }

    const upstream = await fetch(target, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-RTB-Bridge-Secret": bridgeSecret,
      },
      body,
    });
    const payload = await upstream.json().catch(() => ({}));
    return response({ ...payload, connected: upstream.ok }, upstream.status);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "TextNow proxy failed." }, 500);
  }
});
