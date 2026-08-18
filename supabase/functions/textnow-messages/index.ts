import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function normalizeRow(row: any) {
  return {
    id: row.message_id || row.source_key,
    number: row.number,
    content: row.content,
    date: row.message_date,
    read: Boolean(row.is_read),
    direction: row.direction,
    first_contact: Boolean(row.first_contact),
    type: row.message_type,
    content_type: row.content_type,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
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

    const input = await req.json().catch(() => ({}));
    const action = String(input?.action || "messages").toLowerCase();
    const limit = Math.max(1, Math.min(Number(input?.limit || 100), 250));
    const number = String(input?.number || "").trim();
    const message = String(input?.message || "").trim();

    if (action === "health") {
      const { data: state } = await admin.from("textnow_sync_state").select("*").eq("id", "textnow").maybeSingle();
      const lastSuccess = state?.last_success_at ? new Date(state.last_success_at).getTime() : 0;
      const ageMinutes = lastSuccess ? Math.round((Date.now() - lastSuccess) / 60000) : null;
      return response({
        ok: Boolean(state?.last_success_at),
        configured: true,
        connected: ageMinutes !== null && ageMinutes <= 15,
        mode: "github-actions",
        last_sync_at: state?.last_run_at || null,
        last_success_at: state?.last_success_at || null,
        last_error: state?.last_error || null,
        sync_age_minutes: ageMinutes,
      });
    }

    if (action === "send") {
      if (!number || !message) return response({ error: "Phone number and message are required." }, 400);
      if (!owner && !["edit", "admin"].includes(messagesLevel)) {
        return response({ error: "Send access is not enabled for this account." }, 403);
      }
      const { data, error } = await admin
        .from("textnow_outbox")
        .insert({ number, message, created_by: authData.user.id, status: "queued" })
        .select("id,status,created_at")
        .single();
      if (error) return response({ error: error.message }, 500);
      return response({ ok: true, queued: true, ...data });
    }

    if (action === "conversation") {
      if (!number) return response({ error: "Phone number is required." }, 400);
      const { data, error } = await admin
        .from("textnow_messages")
        .select("source_key,message_id,number,content,message_date,is_read,direction,first_contact,message_type,content_type")
        .eq("number", number)
        .order("message_date", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) return response({ error: error.message }, 500);
      return response({ messages: (data || []).map(normalizeRow), connected: true, mode: "github-actions" });
    }

    if (action === "messages") {
      const { data, error } = await admin
        .from("textnow_messages")
        .select("source_key,message_id,number,content,message_date,is_read,direction,first_contact,message_type,content_type")
        .order("message_date", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) return response({ error: error.message }, 500);
      return response({ messages: (data || []).map(normalizeRow), connected: true, mode: "github-actions" });
    }

    return response({ error: "Unsupported TextNow action." }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "TextNow request failed." }, 500);
  }
});
