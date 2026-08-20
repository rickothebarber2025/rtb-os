import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Papa from "npm:papaparse@5.4.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LEVEL_RANK: Record<string, number> = { none: 0, view: 1, edit: 2, admin: 3 };

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
  } catch {
    return "";
  }
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePermissions(value: unknown) {
  if (!value) return {} as Record<string, any>;
  if (typeof value === "string") {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return typeof value === "object" ? value as Record<string, any> : {};
}

function financeLevel(profile: any) {
  if (!profile) return "none";
  const email = clean(profile.email).toLowerCase();
  const role = clean(profile.role).toLowerCase();
  if (email === "rickothebarber@gmail.com" || role === "owner") return "admin";
  if (profile.active === false) return "none";
  const payload = normalizePermissions(profile.permissions);
  return clean(payload?.modules?.finance || payload?.finance || "none").toLowerCase();
}

function can(profile: any, minimum: "view" | "edit" | "admin") {
  return (LEVEL_RANK[financeLevel(profile)] || 0) >= LEVEL_RANK[minimum];
}

function businessAllowed(profile: any, businessId: string) {
  if (!profile || !businessId || businessId === "all-businesses") return false;
  const email = clean(profile.email).toLowerCase();
  const role = clean(profile.role).toLowerCase();
  if (email === "rickothebarber@gmail.com" || role === "owner") return true;
  const payload = normalizePermissions(profile.permissions);
  if (clean(payload.business_scope).toLowerCase() === "all") return true;
  const ids = Array.isArray(payload.business_unit_ids) ? payload.business_unit_ids.map(String) : [];
  return ids.includes("all-businesses") || ids.includes(businessId) || clean(profile.business_unit_id) === businessId;
}

function monthStartToronto() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  return `${year}-${month}-01`;
}

function normalizedMonthlyAmount(row: any) {
  const amount = Number(row?.amount || 0);
  switch (clean(row?.frequency).toLowerCase()) {
    case "weekly": return amount * 52 / 12;
    case "biweekly": return amount * 26 / 12;
    case "quarterly": return amount / 3;
    case "yearly": return amount / 12;
    default: return amount;
  }
}

function firstValue(row: Record<string, unknown>, names: string[]) {
  const entries = Object.entries(row || {});
  const found = entries.find(([key]) => names.some((name) => key.toLowerCase().includes(name)));
  return found?.[1];
}

function parseMoney(value: unknown) {
  const text = clean(value).replace(/[,$]/g, "").replace(/^\((.*)\)$/, "-$1");
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

function parseDate(value: unknown) {
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeCsvRow(raw: Record<string, unknown>, businessId: string) {
  const description = clean(firstValue(raw, ["description", "merchant", "payee", "memo", "name", "details"]));
  if (!description) return null;

  const debit = parseMoney(firstValue(raw, ["debit", "withdrawal", "money out", "outflow"]));
  const credit = parseMoney(firstValue(raw, ["credit", "deposit", "money in", "inflow"]));
  const generic = parseMoney(firstValue(raw, ["amount"]));

  let direction = "expense";
  let amount = 0;
  if (debit !== null && debit !== 0) {
    direction = "expense";
    amount = Math.abs(debit);
  } else if (credit !== null && credit !== 0) {
    direction = "income";
    amount = Math.abs(credit);
  } else if (generic !== null && generic !== 0) {
    // Most bank exports represent debits as negative and credits as positive.
    direction = generic < 0 ? "expense" : "income";
    amount = Math.abs(generic);
  } else {
    return null;
  }

  const transactionDate = parseDate(firstValue(raw, ["transaction date", "posting date", "posted date", "date"]));
  if (!transactionDate || amount <= 0) return null;

  return {
    business_unit_id: businessId,
    transaction_date: transactionDate,
    direction,
    amount,
    category: clean(firstValue(raw, ["category"])) || "Imported",
    description,
    source: "csv",
    external_ref: clean(firstValue(raw, ["reference", "transaction id", "id"])) || null,
  };
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
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("email,role,active,business_unit_id,permissions")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "Your RTB OS profile could not be loaded." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action).toLowerCase();
    const businessId = clean(body.businessId || body.business_id || body.payload?.business_unit_id);
    const minimum = ["delete_transaction", "delete_obligation"].includes(action) ? "admin" : action === "snapshot" ? "view" : "edit";
    if (!can(profile, minimum as any)) return json({ error: `Finance ${minimum} access is required.` }, 403);
    if (!businessAllowed(profile, businessId)) return json({ error: "You do not have Finance access to this business." }, 403);

    if (action === "snapshot") {
      const monthStart = monthStartToronto();
      const [transactionsResult, obligationsResult, payrollResult, importRunsResult] = await Promise.all([
        admin.from("finance_transactions").select("*").eq("business_unit_id", businessId).order("transaction_date", { ascending: false }).limit(250),
        admin.from("finance_obligations").select("*").eq("business_unit_id", businessId).order("due_day", { ascending: true }),
        admin.from("payroll_runs").select("week_label,status,total_net_sales,total_staff_payout,total_deductions,rtb_net,week_start,week_end").eq("business_unit_id", businessId).order("week_start", { ascending: false }).limit(8),
        admin.from("finance_import_runs").select("id,file_name,imported_count,rejected_count,created_at").eq("business_unit_id", businessId).order("created_at", { ascending: false }).limit(10),
      ]);
      for (const result of [transactionsResult, obligationsResult, payrollResult, importRunsResult]) {
        if (result.error) throw result.error;
      }
      const transactions = transactionsResult.data || [];
      const obligations = obligationsResult.data || [];
      const current = transactions.filter((row: any) => clean(row.transaction_date) >= monthStart);
      const income = current.filter((row: any) => row.direction === "income").reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
      const expenses = current.filter((row: any) => row.direction === "expense").reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
      const recurring = obligations.filter((row: any) => row.status === "active").reduce((sum: number, row: any) => sum + normalizedMonthlyAmount(row), 0);
      return json({
        transactions,
        obligations,
        recent_imports: importRunsResult.data || [],
        recent_payroll: payrollResult.data || [],
        metrics: { income, expenses, net: income - expenses, recurring, month_start: monthStart },
        generated_at: new Date().toISOString(),
      });
    }

    if (action === "create_transaction") {
      const payload = body.payload || {};
      const { data, error } = await admin.from("finance_transactions").insert({
        business_unit_id: businessId,
        transaction_date: clean(payload.transaction_date),
        direction: clean(payload.direction),
        amount: Number(payload.amount),
        category: clean(payload.category) || "Uncategorized",
        description: clean(payload.description),
        source: clean(payload.source) || "manual",
        external_ref: clean(payload.external_ref) || null,
        notes: clean(payload.notes) || null,
        created_by: authData.user.id,
      }).select("*").single();
      if (error) throw error;
      return json({ transaction: data });
    }

    if (action === "delete_transaction") {
      const id = clean(body.id);
      const { error } = await admin.from("finance_transactions").delete().eq("id", id).eq("business_unit_id", businessId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "create_obligation") {
      const payload = body.payload || {};
      const { data, error } = await admin.from("finance_obligations").insert({
        business_unit_id: businessId,
        name: clean(payload.name),
        amount: Number(payload.amount),
        due_day: Number(payload.due_day || 1),
        frequency: clean(payload.frequency) || "monthly",
        category: clean(payload.category) || "Operating expense",
        status: clean(payload.status) || "active",
        notes: clean(payload.notes) || null,
        created_by: authData.user.id,
      }).select("*").single();
      if (error) throw error;
      return json({ obligation: data });
    }

    if (action === "delete_obligation") {
      const id = clean(body.id);
      const { error } = await admin.from("finance_obligations").delete().eq("id", id).eq("business_unit_id", businessId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "import_csv") {
      const csvText = String(body.csvText || "");
      const fileName = clean(body.fileName) || "statement.csv";
      if (!csvText) return json({ error: "CSV content is empty." }, 400);
      const parsed = Papa.parse<Record<string, unknown>>(csvText, { header: true, skipEmptyLines: true });
      const normalized = (parsed.data || []).map((row) => normalizeCsvRow(row, businessId)).filter(Boolean) as Record<string, unknown>[];
      if (!normalized.length) return json({ error: "No recognizable finance transactions were found in this CSV." }, 400);
      const rows = normalized.map((row) => ({ ...row, created_by: authData.user.id }));
      const { data: inserted, error: insertError } = await admin.from("finance_transactions").insert(rows).select("*");
      if (insertError) throw insertError;
      const rejectedCount = Math.max(0, (parsed.data?.length || 0) - (inserted?.length || 0));
      const { data: importRun, error: runError } = await admin.from("finance_import_runs").insert({
        business_unit_id: businessId,
        file_name: fileName,
        imported_count: inserted?.length || 0,
        rejected_count: rejectedCount,
        created_by: authData.user.id,
      }).select("*").single();
      if (runError) throw runError;
      return json({ transactions: inserted || [], import_run: importRun, parse_errors: parsed.errors?.slice(0, 10) || [] });
    }

    return json({ error: "Unknown Finance action." }, 400);
  } catch (error) {
    console.error("finance-api", error);
    return json({ error: error instanceof Error ? error.message : "Finance request failed." }, 500);
  }
});
