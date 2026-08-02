import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_ROWS_PER_SYNC = Number(Deno.env.get("PAYROLL_SYNC_MAX_ROWS") || 500);

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-rtb-sync-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

class RequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const FIELD_ALIASES: Record<string, string[]> = {
  applied_commission_rate: [
    "applied_commission_rate",
    "applied_commission",
    "actual_commission_rate",
    "commission_applied",
  ],
  base_commission_rate: [
    "base_commission_rate",
    "commission_rate",
    "base_commission",
    "standard_rate",
  ],
  business_unit: [
    "business_unit",
    "business_unit_name",
    "business",
    "lounge",
    "location",
  ],
  business_unit_id: ["business_unit_id", "business_id", "location_id"],
  deduction: ["deduction", "deductions", "rtb_deduction", "five_dollar_deduction"],
  fixed_rate: ["fixed_rate", "fixed", "is_fixed_rate"],
  net_sales: ["net_sales", "sales", "net", "service_sales", "total_net_sales"],
  notes: ["notes", "note", "memo"],
  owner_net_sales: ["owner_net_sales", "owner_sales", "rtb_owner_net_sales"],
  owner_tips: ["owner_tips", "owner_tip"],
  paystub_status: ["paystub_status", "pay_stub_status", "statement_status"],
  role: ["role", "staff_role", "position"],
  source_staff_id: [
    "source_staff_id",
    "square_staff_id",
    "booksy_staff_id",
    "team_member_id",
    "employee_id",
    "provider_id",
  ],
  staff_email: ["staff_email", "employee_email", "team_member_email", "email"],
  staff_id: ["staff_id", "rtb_staff_id"],
  staff_name: [
    "staff_name",
    "employee_name",
    "team_member",
    "team_member_name",
    "name",
    "staff",
  ],
  take_home: ["take_home", "takehome", "take_home_pay", "pay", "payout"],
  tier: ["tier", "staff_tier", "commission_tier"],
  tips: ["tips", "tip", "gratuity", "gratuities"],
  week_end: ["week_end", "payroll_week_end", "end_date", "period_end"],
  week_label: ["week_label", "payroll_week", "week", "period", "pay_period"],
  week_start: ["week_start", "payroll_week_start", "start_date", "period_start"],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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

function getExpectedSecret() {
  return (
    Deno.env.get("GOOGLE_SHEETS_PAYROLL_SYNC_SECRET") ||
    Deno.env.get("PAYROLL_SYNC_SECRET") ||
    ""
  );
}

function cleanKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeSourceRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [cleanKey(key), value]),
  );
}

function pick(row: Record<string, unknown>, key: string) {
  for (const alias of FIELD_ALIASES[key] || [key]) {
    const normalizedAlias = cleanKey(alias);
    const value = row[normalizedAlias];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function parseString(
  row: Record<string, unknown>,
  key: string,
  rowNumber: number,
  required = false,
) {
  const value = pick(row, key);
  const text = value === undefined || value === null ? "" : String(value).trim();

  if (required && !text) {
    throw new RequestError(`Row ${rowNumber} is missing ${key}.`);
  }

  return text;
}

function parseNumber(row: Record<string, unknown>, key: string, rowNumber: number, fallback = 0) {
  const value = pick(row, key);
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value)
    .replace(/[$,%]/g, "")
    .replace(/,/g, "")
    .trim();
  const parsed = Number(text);

  if (!Number.isFinite(parsed)) {
    throw new RequestError(`Row ${rowNumber} has an invalid ${key} value.`);
  }

  return parsed;
}

function parseBoolean(row: Record<string, unknown>, key: string) {
  const value = pick(row, key);
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const text = String(value).trim().toLowerCase();
  if (["true", "yes", "y", "1", "fixed"].includes(text)) return true;
  if (["false", "no", "n", "0", "standard"].includes(text)) return false;
  return undefined;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateKey(row: Record<string, unknown>, key: string, rowNumber: number) {
  const value = pick(row, key);
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new RequestError(`Row ${rowNumber} is missing ${key}.`);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (mdy) {
    return `${mdy[3]}-${pad(Number(mdy[1]))}-${pad(Number(mdy[2]))}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw new RequestError(`Row ${rowNumber} has an invalid ${key} date.`);
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizePaystubStatus(value: string) {
  return ["pending", "sent", "failed", "skipped"].includes(value) ? value : "sent";
}

function normalizePayrollRow(source: unknown, index: number) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new RequestError(`Row ${index + 2} is not a valid object.`);
  }

  const sourceRow = source as Record<string, unknown>;
  const row = normalizeSourceRow(sourceRow);
  const rowNumber = index + 2;
  const businessUnitId = parseString(row, "business_unit_id", rowNumber);
  const businessUnitName =
    parseString(row, "business_unit", rowNumber) ||
    Deno.env.get("PAYROLL_SYNC_DEFAULT_BUSINESS_UNIT") ||
    "";
  const fixedRate = parseBoolean(row, "fixed_rate");

  if (!businessUnitId && !businessUnitName) {
    throw new RequestError(`Row ${rowNumber} is missing a business or business_unit_id.`);
  }

  return {
    applied_commission_rate: parseNumber(row, "applied_commission_rate", rowNumber, 0) || null,
    base_commission_rate: parseNumber(row, "base_commission_rate", rowNumber, 0) || null,
    business_unit: businessUnitName,
    business_unit_id: businessUnitId || null,
    deduction: parseNumber(row, "deduction", rowNumber, 0) || null,
    fixed_rate: fixedRate,
    net_sales: parseNumber(row, "net_sales", rowNumber, 0),
    notes: parseString(row, "notes", rowNumber),
    owner_net_sales: parseNumber(row, "owner_net_sales", rowNumber, 0),
    owner_tips: parseNumber(row, "owner_tips", rowNumber, 0),
    paystub_status: normalizePaystubStatus(parseString(row, "paystub_status", rowNumber)),
    role: parseString(row, "role", rowNumber),
    source_staff_id: parseString(row, "source_staff_id", rowNumber),
    source_row: sourceRow,
    staff_email: parseString(row, "staff_email", rowNumber),
    staff_id: parseString(row, "staff_id", rowNumber),
    staff_name: parseString(row, "staff_name", rowNumber, true),
    take_home: parseNumber(row, "take_home", rowNumber, 0) || null,
    tier: parseString(row, "tier", rowNumber),
    tips: parseNumber(row, "tips", rowNumber, 0),
    week_end: parseDateKey(row, "week_end", rowNumber),
    week_label: parseString(row, "week_label", rowNumber),
    week_start: parseDateKey(row, "week_start", rowNumber),
  };
}

function authorizeRequest(req: Request) {
  const expectedSecret = getExpectedSecret();
  const providedSecret =
    req.headers.get("x-rtb-sync-token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

  if (!expectedSecret) {
    throw new RequestError("Google Sheets payroll sync secret is not configured.", 500);
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    throw new RequestError("Invalid payroll sync token.", 401);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    authorizeRequest(req);

    const body = await req.json().catch(() => {
      throw new RequestError("Request body must be valid JSON.");
    });
    const rows = Array.isArray(body) ? body : body?.rows;

    if (!Array.isArray(rows)) {
      throw new RequestError("Payload must include a rows array.");
    }

    if (rows.length === 0) {
      throw new RequestError("No rows were sent from Google Sheets.");
    }

    if (rows.length > MAX_ROWS_PER_SYNC) {
      throw new RequestError(`Sync is limited to ${MAX_ROWS_PER_SYNC} rows per request.`);
    }

    const normalizedRows = rows.map((row, index) => normalizePayrollRow(row, index));
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("sync_google_sheets_payroll", {
      p_rows: normalizedRows,
    });

    if (error) {
      throw new RequestError(error.message || "Payroll sync failed.", 400);
    }

    return jsonResponse({
      ...data,
      message: `Synced ${data?.records_upserted || normalizedRows.length} payroll records to RTB OS.`,
    });
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Payroll sync failed.";
    return jsonResponse({ error: message, ok: false }, status);
  }
});
