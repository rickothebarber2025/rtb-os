import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

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

async function gatherContext(admin: ReturnType<typeof createClient>, businessId: string) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [business, staff] = await Promise.all([
    safe(admin.from("business_units").select("id,name,type").eq("id", businessId).maybeSingle(), null),
    safe(admin.from("staff").select("id,full_name,role,tier,active,fixed_rate").eq("business_unit_id", businessId).order("full_name"), []),
  ]);
  const staffIds = (staff as any[]).map((row) => row.id);

  const [performance, attendance, shifts, checklistRuns, tasks, operationsRequests, activity, feedback, payroll] = await Promise.all([
    safe(admin.from("staff_performance_summary").select("*").eq("business_unit_id", businessId), []),
    safe(admin.from("staff_attendance").select("staff_id,clock_in,clock_out,status,declared_tips").eq("business_unit_id", businessId).gte("clock_in", since).order("clock_in", { ascending: false }).limit(150), []),
    safe(admin.from("staff_shift_records").select("staff_id,shift_date,scheduled_start,scheduled_end,checked_in_at,checked_out_at,status,late_minutes,early_leave_minutes,overtime_minutes,missed_shift,missed_checkout").eq("business_unit_id", businessId).gte("shift_date", today).order("shift_date", { ascending: false }).limit(100), []),
    safe(admin.from("operation_checklist_runs").select("id,staff_id,run_date,checklist_type,scope,status,completion_percent,final_confirmed_by,final_confirmed_at,items:operation_checklist_run_items(label,status,completed_at,completed_by_staff_id,note,photo_url)").eq("business_unit_id", businessId).gte("run_date", today).order("created_at", { ascending: false }).limit(50), []),
    safe(admin.from("staff_tasks").select("staff_id,title,category,details,due_date,status,completed_at,created_at").eq("business_unit_id", businessId).order("created_at", { ascending: false }).limit(100), []),
    safe(admin.from("staff_operations_requests").select("staff_id,request_type,category,title,details,priority,status,manager_note,resolved_at,created_at").eq("business_unit_id", businessId).order("created_at", { ascending: false }).limit(100), []),
    safe(admin.from("owner_activity_events").select("actor_staff_id,category,action,title,body,metadata,created_at").eq("business_unit_id", businessId).gte("created_at", since).order("created_at", { ascending: false }).limit(150), []),
    safe(admin.from("customer_feedback_enriched").select("staff_id,rating,review_text,sentiment,main_category,priority,suggested_action,response_created_at").eq("business_id", businessId).order("response_created_at", { ascending: false }).limit(60), []),
    staffIds.length ? safe(admin.from("payroll_entries").select("staff_id,staff_name_snapshot,net_sales,tips,take_home,created_at").in("staff_id", staffIds).order("created_at", { ascending: false }).limit(80), []) : Promise.resolve([]),
  ]);

  return {
    business,
    staff,
    staff_performance: performance,
    attendance_last_30_days: attendance,
    shifts_today: shifts,
    opening_closing_today: checklistRuns,
    tasks,
    operations_requests: operationsRequests,
    owner_activity_last_30_days: activity,
    customer_feedback: feedback,
    payroll_recent: payroll,
    generated_at: new Date().toISOString(),
    timezone: "America/Toronto",
  };
}

const responseSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    summary: { type: "string" },
    confidence_score: { type: "number" },
    evidence: { type: "array", items: { type: "string" } },
    priorities: { type: "array", items: { type: "string" } },
    suggested_tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          details: { type: "string" },
          category: { type: "string" },
          suggested_staff_name: { type: "string" },
        },
        required: ["title", "details", "category", "suggested_staff_name"],
      },
    },
  },
  required: ["answer", "summary", "confidence_score", "evidence", "priorities", "suggested_tasks"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const key = serviceKey();
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!supabaseUrl || !key) return json({ error: "Supabase function secrets are missing." }, 500);
    if (!geminiKey) return json({ error: "GEMINI_API_KEY is not configured in Supabase secrets." }, 503);

    const admin = createClient(supabaseUrl, key, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

    const body = await req.json().catch(() => ({}));
    const businessId = clean(body.businessId || body.business_id);
    const question = clean(body.question);
    if (!businessId) return json({ error: "Choose one business first." }, 400);
    if (!question) return json({ error: "Ask a question first." }, 400);

    const profile = await safe(admin.from("user_profiles").select("email,active,business_unit_id,permissions,role").eq("id", authData.user.id).maybeSingle(), null as any);
    const owner = clean(profile?.email).toLowerCase() === "rickothebarber@gmail.com";
    const permissions = profile?.permissions || {};
    const modules = permissions.modules || permissions;
    const operationsLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.operations).toLowerCase());
    const businessIds = Array.isArray(permissions.business_unit_ids) ? permissions.business_unit_ids.map(String) : [];
    const businessAllowed = owner || permissions.business_scope === "all" || businessIds.includes("all-businesses") || businessIds.includes(businessId) || profile?.business_unit_id === businessId;
    if (!profile?.active || (!owner && (operationsLevel < 1 || !businessAllowed))) {
      return json({ error: "You do not have permission to use RTB Gemini for this business." }, 403);
    }

    const context = await gatherContext(admin, businessId);
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
    const system = [
      "You are RTB Gemini, the private operating copilot for RTB Lounge and RTB Beauty Lounge.",
      "Use ONLY the supplied RTB OS business context as factual evidence. Never invent staff actions, sales, attendance, checklist completion, or customer feedback.",
      "The owner wants direct, critical, decision-oriented answers. Identify operational risk, accountability gaps, revenue opportunities, and the next best actions.",
      "For questions about today, prioritize shifts_today, opening_closing_today, tasks, operations_requests, and owner_activity_last_30_days.",
      "For staff questions, name staff only when the supplied data supports it. If records are missing or incomplete, explicitly say what is missing.",
      "Suggested tasks must be actionable and use a real roster name when possible; otherwise suggested_staff_name should be Owner.",
      "Do not alter payroll, permissions, or financial data. Return JSON only matching the schema.",
    ].join(" ");

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ question, business_context: context }) }] }],
        generationConfig: { temperature: 0.25, responseMimeType: "application/json", responseSchema },
      }),
    });

    const raw = await geminiResponse.json().catch(() => ({}));
    if (!geminiResponse.ok) return json({ error: raw?.error?.message || "Gemini request failed." }, 502);
    const text = raw?.candidates?.[0]?.content?.parts?.find((part: any) => part.text)?.text || "";
    if (!text) return json({ error: "Gemini returned an empty response." }, 502);
    const parsed = JSON.parse(text);

    return json({ ...parsed, model, data_scope: "rtb_os_live", generated_at: new Date().toISOString() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "RTB Gemini failed." }, 500);
  }
});
