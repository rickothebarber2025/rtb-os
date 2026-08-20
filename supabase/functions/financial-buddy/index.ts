import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function serviceKey() {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!keys) return "";
  try {
    const parsed = JSON.parse(keys);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch { return ""; }
}

function isFinanceAllowed(profile: any) {
  if (!profile) return false;
  if (String(profile.email || "").toLowerCase() === "rickothebarber@gmail.com" || profile.role === "owner" || profile.is_owner) return true;
  const permissions = typeof profile.permissions === "string" ? JSON.parse(profile.permissions || "{}") : (profile.permissions || {});
  const level = permissions?.modules?.finance || permissions?.finance || "none";
  return ["view", "edit", "admin"].includes(String(level).toLowerCase());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const key = serviceKey();
    const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
    if (!supabaseUrl || !key) return json({ error: "Supabase function secrets are missing." }, 500);
    if (!geminiKey) return json({ error: "GEMINI_API_KEY is not configured." }, 500);

    const admin = createClient(supabaseUrl, key, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

    const { data: profile } = await admin.from("user_profiles").select("email,role,is_owner,permissions,active").eq("id", authData.user.id).maybeSingle();
    if (!isFinanceAllowed(profile)) return json({ error: "Finance access is not enabled for this account." }, 403);

    const body = await req.json().catch(() => ({}));
    const businessId = String(body.businessId || body.business_id || "").trim();
    const question = String(body.question || "Give me a concise financial health check.").trim();
    if (!businessId || businessId === "all-businesses") return json({ error: "Choose one business before asking Financial Buddy." }, 400);

    const monthStart = new Date();
    monthStart.setDate(1);
    const monthStartIso = monthStart.toISOString().slice(0, 10);

    const [{ data: business }, { data: transactions }, { data: obligations }, { data: payrollRuns }, { data: performance }] = await Promise.all([
      admin.from("business_units").select("id,name,type").eq("id", businessId).maybeSingle(),
      admin.from("finance_transactions").select("transaction_date,direction,amount,category,description,source").eq("business_unit_id", businessId).gte("transaction_date", monthStartIso).order("transaction_date", { ascending: false }).limit(120),
      admin.from("finance_obligations").select("name,amount,due_day,frequency,category,status").eq("business_unit_id", businessId).eq("status", "active").order("due_day"),
      admin.from("payroll_runs").select("week_label,status,total_net_sales,total_staff_payout,total_deductions,rtb_net,week_start,week_end").eq("business_unit_id", businessId).order("week_start", { ascending: false }).limit(8),
      admin.from("staff_performance_summary").select("total_net_sales,transactions,average_ticket").eq("business_unit_id", businessId).limit(30),
    ]);

    const payload = { business, month_start: monthStartIso, transactions: transactions || [], recurring_obligations: obligations || [], recent_payroll: payrollRuns || [], performance: performance || [] };
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";
    const system = `You are Financial Buddy inside RTB OS. You advise the owner of a service business using only the supplied business data. Be concise, numerical, practical, and conservative. Distinguish facts from estimates. Focus on cash flow, recurring obligations, payroll pressure, unusual expenses, margin, and the next 1-3 actions. Never invent balances, revenue, taxes, or bank data that are not present. If data is incomplete, say exactly what is missing.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ question, financial_context: payload }) }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 700 },
      }),
    });

    const raw = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: raw?.error?.message || "Financial Buddy request failed." }, 502);
    const answer = raw?.candidates?.[0]?.content?.parts?.find((part: any) => part.text)?.text || "";
    if (!answer) return json({ error: "Financial Buddy returned an empty response." }, 502);
    return json({ answer, generated_at: new Date().toISOString(), business: business?.name || "Selected business" });
  } catch (error) {
    console.error("financial-buddy", error);
    return json({ error: error instanceof Error ? error.message : "Financial Buddy failed." }, 500);
  }
});
