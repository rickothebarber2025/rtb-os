import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const clean = (value: unknown) => String(value ?? "").trim();

function serviceKey() {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!keys) return "";
  try {
    const parsed = JSON.parse(keys);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

async function safe<T>(promise: PromiseLike<{ data: T | null; error: unknown }>, fallback: T): Promise<T> {
  try {
    const result = await promise;
    return result.error ? fallback : (result.data ?? fallback);
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const key = serviceKey();
    if (!supabaseUrl || !key) return json({ error: "Supabase function secrets are missing." }, 500);

    const admin = createClient(supabaseUrl, key, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your RTB OS session is invalid or expired." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "list").toLowerCase();
    const businessId = clean(body.businessId || body.business_id);
    if (!businessId) return json({ error: "Choose one business first." }, 400);

    const profile = await safe(
      admin.from("user_profiles")
        .select("email,active,business_unit_id,permissions,role")
        .eq("id", authData.user.id)
        .maybeSingle(),
      null as any,
    );

    const owner = clean(profile?.email).toLowerCase() === "rickothebarber@gmail.com";
    const permissions = profile?.permissions || {};
    const modules = permissions.modules || permissions;
    const operationsLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.operations).toLowerCase());
    const dashboardLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.dashboard).toLowerCase());
    const businessIds = Array.isArray(permissions.business_unit_ids) ? permissions.business_unit_ids.map(String) : [];
    const businessAllowed = owner || permissions.business_scope === "all" || businessIds.includes("all-businesses") || businessIds.includes(businessId) || profile?.business_unit_id === businessId;
    const manager = owner || operationsLevel >= 2 || dashboardLevel >= 1 || ["admin", "manager", "owner"].includes(clean(profile?.role).toLowerCase());
    if (!profile?.active || !businessAllowed || !manager) return json({ error: "Manager access is required." }, 403);

    if (action === "list") {
      const requests = await safe(
        admin.from("staff_time_off_requests")
          .select("id,business_unit_id,staff_id,start_date,end_date,reason,status,admin_note,notice_hours,meets_notice_policy,decided_at,created_at,updated_at")
          .eq("business_unit_id", businessId)
          .eq("status", "pending")
          .order("start_date", { ascending: true })
          .limit(60),
        [],
      );

      const staffIds = [...new Set((requests as any[]).map((row) => row.staff_id).filter(Boolean))];
      const staff = staffIds.length
        ? await safe(admin.from("staff").select("id,full_name,role,active").in("id", staffIds), [])
        : [];
      const staffById = new Map((staff as any[]).map((row) => [row.id, row]));

      const approved = await safe(
        admin.from("staff_time_off_requests")
          .select("id,staff_id,start_date,end_date,status")
          .eq("business_unit_id", businessId)
          .eq("status", "approved")
          .gte("end_date", new Date().toISOString().slice(0, 10))
          .order("start_date", { ascending: true })
          .limit(100),
        [],
      );

      const enriched = (requests as any[]).map((request) => {
        const overlapCount = (approved as any[]).filter((other) =>
          other.staff_id !== request.staff_id &&
          other.start_date <= request.end_date &&
          other.end_date >= request.start_date
        ).length;
        return {
          ...request,
          staff_name: staffById.get(request.staff_id)?.full_name || "Staff member",
          staff_role: staffById.get(request.staff_id)?.role || "",
          coverage_overlap_count: overlapCount,
          review_flags: [
            request.meets_notice_policy === false ? "Less than required notice" : "",
            overlapCount > 0 ? `${overlapCount} other approved absence${overlapCount === 1 ? "" : "s"} overlap` : "",
          ].filter(Boolean),
        };
      });

      return json({ requests: enriched });
    }

    if (action === "decide") {
      if (!owner && operationsLevel < 2) return json({ error: "Operations edit access is required to decide time off." }, 403);
      const requestId = clean(body.requestId || body.request_id);
      const decision = clean(body.decision || body.status).toLowerCase();
      const adminNote = clean(body.adminNote || body.admin_note);
      if (!requestId || !["approved", "denied"].includes(decision)) return json({ error: "Choose Approve or Deny." }, 400);

      const existing = await safe(
        admin.from("staff_time_off_requests")
          .select("id,business_unit_id,staff_id,status")
          .eq("id", requestId)
          .eq("business_unit_id", businessId)
          .maybeSingle(),
        null as any,
      );
      if (!existing) return json({ error: "Time-off request was not found." }, 404);
      if (existing.status !== "pending") return json({ error: `This request is already ${existing.status}.` }, 409);

      const { data, error } = await admin.from("staff_time_off_requests")
        .update({
          status: decision,
          admin_note: adminNote || null,
          decided_at: new Date().toISOString(),
          decided_by: authData.user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)
        .eq("business_unit_id", businessId)
        .eq("status", "pending")
        .select()
        .single();
      if (error) throw error;
      return json({ request: data });
    }

    return json({ error: "Unsupported time-off action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Time-off review failed." }, 500);
  }
});