import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  RequestError,
  authorizeManager,
  cleanText,
  corsHeaders,
  getAdminClient,
  jsonResponse,
  readJson,
} from "../_shared/rtb.ts";

type AdminClient = ReturnType<typeof createClient>;

const SQUARE_API_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") || "2026-05-20";

// Square's location IDs for each real business -- confirmed directly
// against a live /v2/locations call before writing this, not guessed.
const LOCATION_TO_BUSINESS_NAME: Record<string, string> = {
  "BYYR1W9SMFWS6": "RTB Lounge",
  "LJK9F49SHT4B0": "RTB Beauty Lounge",
};

const ATTENDANCE_REQUIREMENTS = [
  { module: "operations", minimum: "edit" },
  { module: "performance", minimum: "edit" },
];

async function fetchSquare(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`${SQUARE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
      ...(init.headers || {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.errors?.[0]?.detail || `Square request to ${path} failed.`;
    throw new RequestError(message, response.status === 401 ? 502 : 400);
  }

  return body;
}

// Same normalization/matching approach as squarePayrollImport.js on the
// frontend (first-name fallback, with an explicit alias table for staff
// whose Square display name doesn't reduce to a simple first-word match).
// Kept in sync manually since this runs server-side in Deno, not through
// the frontend bundle.
const SQUARE_NAME_ALIASES: Record<string, string> = {
  "daniel ndayishiruye": "daniel",
  "darryl achy": "darryl",
  "leyla garba": "leyla",
  "ricardo joseph": "ricko",
  "ronia indagiye": "ronia",
  "rsean mathurin": "roshi",
  "sara leguizamon": "sara",
  "steph bell": "steph",
  "wavyboy gatoni": "josh",
};

function normalizeName(value: string) {
  return cleanText(value).toLowerCase().replace(/[^a-z\s]/g, "").trim();
}

function matchSquareNameToStaff(squareName: string, staffList: Array<{ full_name: string; id: string }>) {
  const normalized = normalizeName(squareName);
  if (!normalized) return null;

  const alias = SQUARE_NAME_ALIASES[normalized];
  if (alias) {
    const aliasMatch = staffList.find((member) => normalizeName(member.full_name) === alias);
    if (aliasMatch) return aliasMatch;
  }

  const exactMatch = staffList.find((member) => normalizeName(member.full_name) === normalized);
  if (exactMatch) return exactMatch;

  const firstWord = normalized.split(" ")[0];
  return staffList.find((member) => normalizeName(member.full_name).split(" ")[0] === firstWord) || null;
}

async function syncAttendance(admin: AdminClient, accessToken: string, days: number) {
  const teamBody = await fetchSquare("/v2/team-members/search", accessToken, {
    body: JSON.stringify({ query: { filter: { status: "ACTIVE" } } }),
    method: "POST",
  });
  const teamMembers = (teamBody.team_members || []) as Array<Record<string, unknown>>;

  const { data: staffList, error: staffError } = await admin
    .from("staff")
    .select("id,full_name,square_team_member_id,business_unit_id")
    .eq("active", true);
  if (staffError) throw staffError;

  const teamMemberToStaffId = new Map<string, string>();
  const unmatchedNames: string[] = [];

  for (const member of teamMembers) {
    const squareId = String(member.id || "");
    if (!squareId) continue;

    const alreadyLinked = (staffList || []).find((row) => row.square_team_member_id === squareId);
    if (alreadyLinked) {
      teamMemberToStaffId.set(squareId, alreadyLinked.id as string);
      continue;
    }

    const displayName = cleanText(
      `${member.given_name || ""} ${member.family_name || ""}`.trim() || (member.reference_id as string) || "",
    );
    const matched = matchSquareNameToStaff(displayName, (staffList || []) as Array<{ full_name: string; id: string }>);

    if (matched) {
      teamMemberToStaffId.set(squareId, matched.id);
      await admin.from("staff").update({ square_team_member_id: squareId }).eq("id", matched.id);
    } else if (displayName) {
      unmatchedNames.push(displayName);
    }
  }

  const startAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const shiftsBody = await fetchSquare("/v2/labor/shifts/search", accessToken, {
    body: JSON.stringify({ query: { filter: { start: { start_at: startAt } } } }),
    method: "POST",
  });
  const shifts = (shiftsBody.shifts || []) as Array<Record<string, unknown>>;

  let inserted = 0;
  let updated = 0;
  let skippedNoBusiness = 0;
  const unmatchedStaffShifts = new Set<string>();

  for (const shift of shifts) {
    const locationId = String(shift.location_id || "");
    const businessName = LOCATION_TO_BUSINESS_NAME[locationId];
    if (!businessName) {
      skippedNoBusiness += 1;
      continue;
    }

    const { data: business } = await admin
      .from("business_units")
      .select("id")
      .eq("name", businessName)
      .maybeSingle();
    if (!business) {
      skippedNoBusiness += 1;
      continue;
    }

    const teamMemberId = String(shift.team_member_id || shift.employee_id || "");
    const staffId = teamMemberToStaffId.get(teamMemberId) || null;
    if (!staffId) unmatchedStaffShifts.add(teamMemberId);

    const { data: existing } = await admin
      .from("staff_attendance")
      .select("id")
      .eq("square_shift_id", String(shift.id))
      .maybeSingle();

    const declaredTipMoney = (shift.declared_cash_tip_money as Record<string, unknown>) || {};
    const record = {
      breaks: Array.isArray(shift.breaks)
        ? shift.breaks.map((brk: Record<string, unknown>) => ({
          end_at: brk.end_at || null,
          name: brk.name || null,
          paid: Boolean(brk.is_paid),
          start_at: brk.start_at || null,
        }))
        : [],
      business_unit_id: business.id,
      clock_in: shift.start_at,
      clock_out: shift.end_at || null,
      declared_tips: Number(declaredTipMoney.amount || 0) / 100,
      square_shift_id: String(shift.id),
      square_team_member_id: teamMemberId,
      staff_id: staffId,
      status: shift.status === "OPEN" ? "open" : "closed",
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await admin.from("staff_attendance").update(record).eq("id", existing.id);
      updated += 1;
    } else {
      await admin.from("staff_attendance").insert(record);
      inserted += 1;
    }
  }

  return {
    shiftsInserted: inserted,
    shiftsSkippedNoBusiness: skippedNoBusiness,
    shiftsUpdated: updated,
    shiftsWithUnmatchedStaff: unmatchedStaffShifts.size,
    teamMembersFound: teamMembers.length,
    unmatchedNames: [...new Set(unmatchedNames)],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new RequestError("Method not allowed.", 405);

    const admin = getAdminClient();
    const body = await readJson(req);
    await authorizeManager(req, admin, body.businessId || null, ATTENDANCE_REQUIREMENTS);

    const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
    if (!accessToken) {
      throw new RequestError("SQUARE_ACCESS_TOKEN Supabase secret is not set.", 500);
    }

    const days = Math.max(1, Math.min(90, Number(body.days) || 30));
    const result = await syncAttendance(admin, accessToken, days);

    return jsonResponse(result);
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Attendance sync failed." },
      status,
    );
  }
});
