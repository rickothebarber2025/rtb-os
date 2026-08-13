import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUMMARY_CACHE_MS = 6 * 60 * 60 * 1000;

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
  return /\b(payroll|pay|earnings|sales|revenue|tips|take[- ]?home|commission|money|financial)\b/i.test(question);
}

async function getCachedSummary(admin: ReturnType<typeof createClient>, businessId: string, audience: "admin" | "staff_hub") {
  return await safe(
    admin
      .from("ai_operations_summaries")
      .select("headline,summary,priorities,evidence,suggested_tasks,model,generated_at")
      .eq("business_unit_id", businessId)
      .eq("audience", audience)
      .eq("summary_date", torontoDate())
      .maybeSingle(),
    null as any,
  );
}

function cachedPayload(row: any) {
  if (!row) return null;
  return {
    answer: row.summary || "",
    summary: row.summary || "",
    priorities: Array.isArray(row.priorities) ? row.priorities : [],
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    suggested_tasks: Array.isArray(row.suggested_tasks) ? row.suggested_tasks : [],
    confidence_score: null,
    model: row.model || null,
    generated_at: row.generated_at || null,
    cached: true,
  };
}

async function gatherLeanContext(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  options: {
    audience: "admin" | "staff_hub";
    currentStaffId?: string | null;
    includeFinancial: boolean;
  },
) {
  const today = torontoDate();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const adminAudience = options.audience === "admin";
  const ownStaffId = options.currentStaffId || null;

  const [business, staff] = await Promise.all([
    safe(admin.from("business_units").select("id,name,type").eq("id", businessId).maybeSingle(), null),
    safe(
      admin
        .from("staff")
        .select("id,full_name,role,tier,active")
        .eq("business_unit_id", businessId)
        .eq("active", true)
        .order("full_name")
        .limit(30),
      [],
    ),
  ]);

  const roster = staff as any[];
  const allowedStaffIds = adminAudience ? roster.map((row) => row.id) : ownStaffId ? [ownStaffId] : [];

  const [checklists, tasks, requests, attendance, performance, payroll] = await Promise.all([
    safe(
      admin
        .from("operation_checklist_runs")
        .select("id,staff_id,run_date,checklist_type,scope,status,completion_percent,final_confirmed_at,items:operation_checklist_run_items(label,status,completed_at,completed_by_staff_id,note)")
        .eq("business_unit_id", businessId)
        .eq("run_date", today)
        .order("created_at", { ascending: false })
        .limit(16),
      [],
    ),
    safe(
      admin
        .from("staff_tasks")
        .select("staff_id,title,category,due_date,status,completed_at")
        .eq("business_unit_id", businessId)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true })
        .limit(24),
      [],
    ),
    safe(
      admin
        .from("staff_operations_requests")
        .select("staff_id,request_type,category,title,priority,status,created_at")
        .eq("business_unit_id", businessId)
        .neq("status", "resolved")
        .order("created_at", { ascending: false })
        .limit(16),
      [],
    ),
    safe(
      admin
        .from("staff_attendance")
        .select("staff_id,clock_in,clock_out,status")
        .eq("business_unit_id", businessId)
        .gte("clock_in", weekAgo)
        .order("clock_in", { ascending: false })
        .limit(24),
      [],
    ),
    adminAudience
      ? safe(
          admin
            .from("staff_performance_summary")
            .select("staff_id,total_net_sales,transactions,average_ticket")
            .eq("business_unit_id", businessId)
            .limit(20),
          [],
        )
      : Promise.resolve([]),
    options.includeFinancial && allowedStaffIds.length
      ? safe(
          admin
            .from("payroll_entries")
            .select("staff_id,staff_name_snapshot,net_sales,tips,take_home,created_at")
            .in("staff_id", allowedStaffIds)
            .order("created_at", { ascending: false })
            .limit(12),
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
    payroll_recent: options.includeFinancial ? filterMine(payroll as any[]) : [],
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
  },
  required: ["answer", "summary", "confidence_score", "evidence", "priorities"],
};

async function askGemini(apiKey: string, model: string, prompt: string, payload: unknown) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 500,
        responseMimeType: "application/json",
        responseSchema,
      },
    }),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(raw?.error?.message || "AI request failed.");
  const text = raw?.candidates?.[0]?.content?.parts?.find((part: any) => part.text)?.text || "";
  if (!text) throw new Error("AI returned an empty response.");
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
    const force = body.force === true;
    if (!businessId) return json({ error: "Choose one business first." }, 400);

    const profile = await safe(
      admin
        .from("user_profiles")
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
      admin
        .from("staff")
        .select("id,full_name,email")
        .eq("business_unit_id", businessId)
        .ilike("email", clean(profile?.email))
        .maybeSingle(),
      null as any,
    );

    if (action === "cached") {
      const cached = await getCachedSummary(admin, businessId, audience);
      return json(cachedPayload(cached) || { cached: false, audience });
    }

    if (action === "automation") {
      if (!manager) return json({ error: "Manager access is required to run automations." }, 403);
      const { data, error } = await admin.rpc("run_rtb_safe_automations");
      if (error) throw error;
      return json({ automation: data });
    }

    if (!geminiKey) return json({ error: "AI is temporarily unavailable." }, 503);
    if (action === "ask" && !question) return json({ error: "Ask a question first." }, 400);

    if (action === "summary" && !force) {
      const cached = await getCachedSummary(admin, businessId, audience);
      const generatedAt = cached?.generated_at ? new Date(cached.generated_at).getTime() : 0;
      if (cached && Date.now() - generatedAt < SUMMARY_CACHE_MS) {
        return json({ ...cachedPayload(cached), audience, cache_age_ms: Date.now() - generatedAt });
      }
    }

    const includeFinancial = Boolean(
      (owner || payrollLevel >= 1) && action === "ask" && questionNeedsFinancialData(question),
    );

    const context = await gatherLeanContext(admin, businessId, {
      audience,
      currentStaffId: currentStaff?.id || null,
      includeFinancial,
    });
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";

    const system = audience === "admin"
      ? [
          "You are RTB AI, a lightweight in-app helper for RTB Lounge and RTB Beauty Lounge.",
          "Use only supplied RTB OS data. Never invent facts.",
          "Answer the user's immediate question directly and briefly.",
          "Prefer one to three useful priorities over a broad business analysis.",
          "Do not run actions or alter payroll, permissions, compensation, or staff records.",
          "Return JSON only.",
        ].join(" ")
      : [
          "You are RTB AI inside Staff Hub, a lightweight helper for one staff member.",
          "Use only the permitted data supplied for that person. Never reveal other staff private data.",
          "Answer briefly and focus on the clearest next action.",
          "Do not run actions or alter records. Return JSON only.",
        ].join(" ");

    const effectiveQuestion = action === "summary"
      ? audience === "admin"
        ? "Give a short operations brief for today. Mention only what needs attention now and one positive signal if present."
        : "Give a short brief for today with the most useful next action."
      : question;

    const parsed = await askGemini(geminiKey, model, system, {
      question: effectiveQuestion,
      context,
    });

    const normalized = {
      ...parsed,
      suggested_tasks: [],
      model,
      audience,
      data_scope: audience === "admin" ? "rtb_os_lean_admin" : "rtb_os_lean_staff",
      generated_at: new Date().toISOString(),
      cached: false,
    };

    if (action === "summary") {
      const { error: saveError } = await admin.from("ai_operations_summaries").upsert({
        business_unit_id: businessId,
        audience,
        summary_date: torontoDate(),
        headline: parsed.priorities?.[0] || "RTB AI brief",
        summary: parsed.summary || parsed.answer,
        priorities: (parsed.priorities || []).slice(0, 3),
        evidence: (parsed.evidence || []).slice(0, 3),
        suggested_tasks: [],
        model,
        generated_at: normalized.generated_at,
      }, { onConflict: "business_unit_id,audience,summary_date" });
      if (saveError) throw saveError;
    }

    return json(normalized);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "RTB AI failed." }, 500);
  }
});
