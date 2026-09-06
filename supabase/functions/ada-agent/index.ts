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

function questionNeedsFinancialData(question: string) {
  return /\b(payroll|pay|earnings|sales|revenue|tips|take[- ]?home|commission|money|financial|profit|cost|wage)\b/i.test(question);
}

async function gatherContext(admin: ReturnType<typeof createClient>, businessId: string, options: {
  audience: "admin" | "staff_hub";
  currentStaffId?: string | null;
  includeFinancial: boolean;
}) {
  const today = torontoDate();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const adminAudience = options.audience === "admin";
  const ownStaffId = options.currentStaffId || null;

  const [business, staff] = await Promise.all([
    safe(admin.from("business_units").select("id,name,type").eq("id", businessId).maybeSingle(), null),
    safe(
      admin.from("staff")
        .select("id,full_name,role,tier,active")
        .eq("business_unit_id", businessId)
        .eq("active", true)
        .order("full_name")
        .limit(60),
      [],
    ),
  ]);

  const roster = staff as any[];
  const allowedStaffIds = adminAudience ? roster.map((row) => row.id) : ownStaffId ? [ownStaffId] : [];

  const [checklists, tasks, requests, attendance, performance, payroll, content, feedback] = await Promise.all([
    safe(
      admin.from("operation_checklist_runs")
        .select("id,staff_id,run_date,checklist_type,scope,status,completion_percent,final_confirmed_at,items:operation_checklist_run_items(label,status,completed_at,completed_by_staff_id,note)")
        .eq("business_unit_id", businessId)
        .gte("run_date", today)
        .order("created_at", { ascending: false })
        .limit(30),
      [],
    ),
    safe(
      admin.from("staff_tasks")
        .select("id,staff_id,title,category,details,due_date,status,completed_at,created_at")
        .eq("business_unit_id", businessId)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true })
        .limit(60),
      [],
    ),
    safe(
      admin.from("staff_operations_requests")
        .select("id,staff_id,request_type,category,title,priority,status,created_at")
        .eq("business_unit_id", businessId)
        .neq("status", "resolved")
        .order("created_at", { ascending: false })
        .limit(40),
      [],
    ),
    safe(
      admin.from("staff_attendance")
        .select("staff_id,clock_in,clock_out,status")
        .eq("business_unit_id", businessId)
        .gte("clock_in", weekAgo)
        .order("clock_in", { ascending: false })
        .limit(80),
      [],
    ),
    adminAudience
      ? safe(
          admin.from("staff_performance_summary")
            .select("staff_id,total_net_sales,transactions,average_ticket")
            .eq("business_unit_id", businessId)
            .limit(50),
          [],
        )
      : Promise.resolve([]),
    options.includeFinancial && allowedStaffIds.length
      ? safe(
          admin.from("payroll_entries")
            .select("staff_id,staff_name_snapshot,net_sales,tips,take_home,created_at")
            .in("staff_id", allowedStaffIds)
            .gte("created_at", monthAgo)
            .order("created_at", { ascending: false })
            .limit(40),
          [],
        )
      : Promise.resolve([]),
    adminAudience
      ? safe(
          admin.from("staff_content_submissions")
            .select("staff_id,status,content_type,created_at")
            .eq("business_unit_id", businessId)
            .order("created_at", { ascending: false })
            .limit(40),
          [],
        )
      : Promise.resolve([]),
    adminAudience
      ? safe(
          admin.from("customer_feedback")
            .select("rating,feedback_text,source,created_at")
            .eq("business_unit_id", businessId)
            .gte("created_at", monthAgo)
            .order("created_at", { ascending: false })
            .limit(30),
          [],
        )
      : Promise.resolve([]),
  ]);

  const filterMine = (rows: any[]) =>
    adminAudience || !ownStaffId ? rows : rows.filter((row) => row.staff_id === ownStaffId);

  return {
    business,
    roster: adminAudience ? roster : roster.filter((row) => row.id === ownStaffId),
    today_checklists: adminAudience ? checklists : filterMine(checklists as any[]),
    open_tasks: filterMine(tasks as any[]),
    unresolved_requests: filterMine(requests as any[]),
    attendance_last_7_days: filterMine(attendance as any[]),
    performance_snapshot: adminAudience ? performance : [],
    payroll_last_30_days: options.includeFinancial ? filterMine(payroll as any[]) : [],
    recent_content_submissions: adminAudience ? content : [],
    recent_customer_feedback: adminAudience ? feedback : [],
    generated_at: new Date().toISOString(),
    timezone: "America/Toronto",
    audience: options.audience,
  };
}

const suggestedTaskSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    details: { type: "string" },
    category: { type: "string" },
    suggested_staff_name: { type: "string" },
    priority: { type: "string" },
    due_hint: { type: "string" },
  },
  required: ["title", "details", "category", "suggested_staff_name", "priority", "due_hint"],
};

const responseSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    summary: { type: "string" },
    confidence_score: { type: "number" },
    evidence: { type: "array", items: { type: "string" } },
    priorities: { type: "array", items: { type: "string" } },
    suggested_tasks: { type: "array", items: suggestedTaskSchema },
    risks: { type: "array", items: { type: "string" } },
    opportunities: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "summary", "confidence_score", "evidence", "priorities", "suggested_tasks", "risks", "opportunities"],
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
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(raw?.error?.message || "Ada request failed.");
  const text = raw?.candidates?.[0]?.content?.parts?.find((part: any) => part.text)?.text || "";
  if (!text) throw new Error("Ada returned an empty response.");
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

    const admin = createClient(supabaseUrl, key, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "ask").toLowerCase();
    const businessId = clean(body.businessId || body.business_id);
    const question = clean(body.question);
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
    const payrollLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.payroll).toLowerCase());
    const businessIds = Array.isArray(permissions.business_unit_ids) ? permissions.business_unit_ids.map(String) : [];
    const businessAllowed = owner || permissions.business_scope === "all" || businessIds.includes("all-businesses") || businessIds.includes(businessId) || profile?.business_unit_id === businessId;
    if (!profile?.active || !businessAllowed) return json({ error: "You do not have access to this business." }, 403);

    const manager = owner || operationsLevel >= 2 || dashboardLevel >= 1 || ["admin", "manager", "owner"].includes(clean(profile?.role).toLowerCase());
    const audience: "admin" | "staff_hub" = manager ? "admin" : "staff_hub";
    const currentStaff = await safe(
      admin.from("staff")
        .select("id,full_name,email")
        .eq("business_unit_id", businessId)
        .ilike("email", clean(profile?.email))
        .maybeSingle(),
      null as any,
    );

    if (!geminiKey) return json({ error: "Ada is temporarily unavailable." }, 503);
    if (action === "ask" && !question) return json({ error: "Ask Ada a question first." }, 400);

    if (action === "automation") {
      if (!manager) return json({ error: "Manager access is required to run automations." }, 403);
      const { data, error } = await admin.rpc("run_rtb_safe_automations");
      if (error) throw error;
      return json({ automation: data });
    }

    const includeFinancial = Boolean(
      (owner || payrollLevel >= 1) && action === "ask" && questionNeedsFinancialData(question),
    );
    const context = await gatherContext(admin, businessId, {
      audience,
      currentStaffId: currentStaff?.id || null,
      includeFinancial,
    });

    const model = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";
    const system = audience === "admin"
      ? [
          "You are Ada, RTB's owner copilot for RTB Lounge and RTB Beauty Lounge.",
          "Use only supplied RTB OS data and never invent facts or fill missing values.",
          "Think across operations, staffing, attendance, tasks, customer experience, content, performance, and financial data when permission allows.",
          "Answer the owner's actual question first, then identify the most important decision or next action.",
          "Be critical: distinguish symptoms from root causes and call out weak processes, missed follow-up, repeated patterns, or unnecessary owner workload.",
          "When evidence supports action, return concrete suggested_tasks with a clear owner, priority and due hint. Do not create or modify records yourself.",
          "Do not recommend disciplinary or compensation decisions from a single weak signal. Use patterns and explain uncertainty.",
          "Keep evidence traceable to the supplied context. Return JSON only.",
        ].join(" ")
      : [
          "You are Ada inside RTB Staff Hub.",
          "Use only the permitted data supplied for this staff member. Never reveal other staff private, payroll, or owner-only information.",
          "Give practical next actions and explain what is due, incomplete, or blocking progress.",
          "Never invent facts and never alter records. Return JSON only.",
        ].join(" ");

    const effectiveQuestion = action === "summary"
      ? audience === "admin"
        ? "Give me today's owner brief. Identify what requires my attention, what can be delegated, one risk, one opportunity, and up to three concrete suggested tasks."
        : "Give me today's staff brief with what is due, what is incomplete, and the best next action."
      : question;

    const parsed = await askGemini(geminiKey, model, system, { question: effectiveQuestion, context });
    return json({
      ...parsed,
      model,
      audience,
      data_scope: audience === "admin" ? "rtb_os_ada_admin" : "rtb_os_ada_staff",
      generated_at: new Date().toISOString(),
      cached: false,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Ada failed." }, 500);
  }
});