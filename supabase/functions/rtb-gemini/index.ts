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

function torontoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function gatherContext(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  options: { audience: "admin" | "staff_hub"; currentStaffId?: string | null; allowFinancial: boolean },
) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const today = torontoDate();
  const adminAudience = options.audience === "admin";

  const [business, staff] = await Promise.all([
    safe(admin.from("business_units").select("id,name,type").eq("id", businessId).maybeSingle(), null),
    safe(admin.from("staff").select("id,full_name,role,tier,active,fixed_rate").eq("business_unit_id", businessId).order("full_name"), []),
  ]);

  const staffRows = staff as any[];
  const staffIds = staffRows.map((row) => row.id);
  const ownStaffId = options.currentStaffId || null;
  const staffFilter = <T extends any[]>(rows: T) =>
    adminAudience || !ownStaffId ? rows : rows.filter((row: any) => row.staff_id === ownStaffId || row.actor_staff_id === ownStaffId);

  const [performance, attendance, shifts, checklistRuns, tasks, operationsRequests, activity, feedback, payroll] = await Promise.all([
    safe(admin.from("staff_performance_summary").select("*").eq("business_unit_id", businessId), []),
    safe(admin.from("staff_attendance").select("staff_id,clock_in,clock_out,status,declared_tips").eq("business_unit_id", businessId).gte("clock_in", since).order("clock_in", { ascending: false }).limit(150), []),
    safe(admin.from("staff_shift_records").select("staff_id,shift_date,scheduled_start,scheduled_end,checked_in_at,checked_out_at,status,late_minutes,early_leave_minutes,overtime_minutes,missed_shift,missed_checkout").eq("business_unit_id", businessId).gte("shift_date", today).order("shift_date", { ascending: false }).limit(100), []),
    safe(admin.from("operation_checklist_runs").select("id,staff_id,run_date,checklist_type,scope,status,completion_percent,final_confirmed_by,final_confirmed_at,items:operation_checklist_run_items(label,status,completed_at,completed_by_staff_id,note,photo_url)").eq("business_unit_id", businessId).gte("run_date", today).order("created_at", { ascending: false }).limit(50), []),
    safe(admin.from("staff_tasks").select("staff_id,title,category,details,due_date,status,completed_at,created_at").eq("business_unit_id", businessId).order("created_at", { ascending: false }).limit(100), []),
    safe(admin.from("staff_operations_requests").select("staff_id,request_type,category,title,details,priority,status,manager_note,resolved_at,created_at").eq("business_unit_id", businessId).order("created_at", { ascending: false }).limit(100), []),
    safe(admin.from("owner_activity_events").select("actor_staff_id,category,action,title,body,metadata,created_at").eq("business_unit_id", businessId).gte("created_at", since).order("created_at", { ascending: false }).limit(150), []),
    safe(admin.from("customer_feedback_enriched").select("staff_id,rating,review_text,sentiment,main_category,priority,suggested_action,response_created_at").eq("business_id", businessId).order("response_created_at", { ascending: false }).limit(60), []),
    options.allowFinancial && staffIds.length
      ? safe(admin.from("payroll_entries").select("staff_id,staff_name_snapshot,net_sales,tips,take_home,created_at").in("staff_id", staffIds).order("created_at", { ascending: false }).limit(80), [])
      : Promise.resolve([]),
  ]);

  const ownPerformance = adminAudience || !ownStaffId
    ? performance
    : (performance as any[]).filter((row) => row.staff_id === ownStaffId);

  return {
    business,
    roster: adminAudience ? staffRows : staffRows.filter((row) => row.id === ownStaffId),
    staff_performance: ownPerformance,
    attendance_last_30_days: staffFilter(attendance as any[]),
    shifts_today: staffFilter(shifts as any[]),
    opening_closing_today: adminAudience
      ? checklistRuns
      : (checklistRuns as any[]).map((run: any) => ({
          checklist_type: run.checklist_type,
          scope: run.scope,
          status: run.status,
          completion_percent: run.completion_percent,
          run_date: run.run_date,
          my_items: Array.isArray(run.items)
            ? run.items.filter((item: any) => item.completed_by_staff_id === ownStaffId)
            : [],
        })),
    tasks: staffFilter(tasks as any[]),
    operations_requests: staffFilter(operationsRequests as any[]),
    owner_activity_last_30_days: adminAudience ? activity : staffFilter(activity as any[]),
    customer_feedback: adminAudience
      ? feedback
      : (feedback as any[]).filter((row) => row.staff_id === ownStaffId),
    payroll_recent: options.allowFinancial
      ? (adminAudience || !ownStaffId ? payroll : (payroll as any[]).filter((row: any) => row.staff_id === ownStaffId))
      : [],
    generated_at: new Date().toISOString(),
    timezone: "America/Toronto",
    audience: options.audience,
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

async function askGemini(apiKey: string, model: string, prompt: string, payload: unknown) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(raw?.error?.message || "Gemini request failed.");
  const text = raw?.candidates?.[0]?.content?.parts?.find((part: any) => part.text)?.text || "";
  if (!text) throw new Error("Gemini returned an empty response.");
  return JSON.parse(text);
}

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
    const action = clean(body.action || "ask").toLowerCase();
    const businessId = clean(body.businessId || body.business_id);
    const question = clean(body.question);
    if (!businessId) return json({ error: "Choose one business first." }, 400);

    const profile = await safe(admin.from("user_profiles").select("email,active,business_unit_id,permissions,role").eq("id", authData.user.id).maybeSingle(), null as any);
    const owner = clean(profile?.email).toLowerCase() === "rickothebarber@gmail.com";
    const permissions = profile?.permissions || {};
    const modules = permissions.modules || permissions;
    const operationsLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.operations).toLowerCase());
    const dashboardLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.dashboard).toLowerCase());
    const payrollLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.payroll).toLowerCase());
    const businessIds = Array.isArray(permissions.business_unit_ids) ? permissions.business_unit_ids.map(String) : [];
    const businessAllowed = owner || permissions.business_scope === "all" || businessIds.includes("all-businesses") || businessIds.includes(businessId) || profile?.business_unit_id === businessId;
    if (!profile?.active || !businessAllowed) return json({ error: "You do not have access to this business." }, 403);

    const manager = owner || operationsLevel >= 2 || dashboardLevel >= 1 || ["admin", "manager", "owner"].includes(clean(profile?.role).toLowerCase());
    const audience: "admin" | "staff_hub" = manager ? "admin" : "staff_hub";
    const currentStaff = await safe(
      admin.from("staff").select("id,full_name,email").eq("business_unit_id", businessId).ilike("email", clean(profile?.email)).maybeSingle(),
      null as any,
    );

    if (action === "automation") {
      if (!manager) return json({ error: "Manager access is required to run automations." }, 403);
      const { data, error } = await admin.rpc("run_rtb_safe_automations");
      if (error) throw error;
      return json({ automation: data });
    }

    if (action === "ask" && !question) return json({ error: "Ask a question first." }, 400);

    if (manager) {
      await admin.rpc("run_rtb_safe_automations").catch(() => null);
    }

    const context = await gatherContext(admin, businessId, {
      audience,
      currentStaffId: currentStaff?.id || null,
      allowFinancial: owner || payrollLevel >= 1,
    });
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";

    const system = audience === "admin"
      ? [
          "You are RTB Gemini, the private operating copilot for the owner and managers of RTB Lounge and RTB Beauty Lounge.",
          "Use only supplied RTB OS data as factual evidence. Never invent staff actions, sales, attendance, checklist completion, or customer feedback.",
          "Summarize what matters, identify operational risk, accountability gaps, revenue opportunities, and the next best actions.",
          "Prioritize today's shifts, opening/closing, overdue tasks, unresolved operations issues, staff activity, and performance.",
          "Do not alter payroll, permissions, compensation, terminations, or financial records. Return JSON only.",
        ].join(" ")
      : [
          "You are RTB Gemini inside Staff Hub. You are coaching one staff member using only their own permitted RTB OS data.",
          "Do not reveal other staff payroll, private performance, attendance, or management-only information.",
          "Summarize today's responsibilities, checklist participation, assigned tasks, attendance signals, client feedback tied to this staff member, and the clearest next action.",
          "Be constructive, specific, concise, and operational. Return JSON only.",
        ].join(" ");

    const effectiveQuestion = action === "summary"
      ? audience === "admin"
        ? "Give me the current RTB owner operations brief. What needs attention now, what is going well, and what should management do next?"
        : "Give me my Staff Hub brief for today: what I need to finish, anything I missed, and the most useful next action."
      : question;

    const parsed = await askGemini(geminiKey, model, system, {
      question: effectiveQuestion,
      business_context: context,
    });

    if (action === "summary") {
      const { error: saveError } = await admin.from("ai_operations_summaries").upsert({
        business_unit_id: businessId,
        audience,
        summary_date: torontoDate(),
        headline: parsed.priorities?.[0] || (audience === "admin" ? "RTB operations brief" : "My RTB brief"),
        summary: parsed.summary || parsed.answer,
        priorities: parsed.priorities || [],
        evidence: parsed.evidence || [],
        suggested_tasks: parsed.suggested_tasks || [],
        model,
        generated_at: new Date().toISOString(),
      }, { onConflict: "business_unit_id,audience,summary_date" });
      if (saveError) throw saveError;
    }

    return json({
      ...parsed,
      model,
      audience,
      data_scope: audience === "admin" ? "rtb_os_admin_live" : "rtb_os_staff_live",
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "RTB Gemini failed." }, 500);
  }
});
