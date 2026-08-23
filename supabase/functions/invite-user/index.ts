import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const ROLE_VALUES = new Set(["admin", "manager", "staff", "contractor", "vendor", "pending"]);
const OWNER_EMAIL = "rickothebarber@gmail.com";
const ALL_BUSINESSES_ACCESS = "all-businesses";
const MODULE_IDS = [
  "staff_hub",
  "dashboard",
  "roster",
  "payroll",
  "performance",
  "finance",
  "appointments",
  "booth_rent",
  "operations",
  "access",
  "settings",
];

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

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizePermission(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function normalizePermissionsPayload(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const source = raw.modules && typeof raw.modules === "object"
    ? raw.modules as Record<string, unknown>
    : raw;
  const modules = Object.fromEntries(
    MODULE_IDS.map((moduleId) => {
      const level = normalizePermission(source[moduleId]);
      return [moduleId, ["none", "view", "edit", "admin"].includes(level) ? level : "none"];
    }),
  );
  const businessUnitIds = Array.isArray(raw.business_unit_ids)
    ? [...new Set(raw.business_unit_ids.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  const hasAllBusinesses =
    raw.business_scope === "all" || businessUnitIds.includes(ALL_BUSINESSES_ACCESS);

  return {
    business_scope: hasAllBusinesses ? "all" : "selected",
    business_unit_ids: hasAllBusinesses ? [ALL_BUSINESSES_ACCESS] : businessUnitIds,
    expectations: String(raw.expectations || ""),
    modules,
    responsibilities: Array.isArray(raw.responsibilities) ? raw.responsibilities : [],
    restrictions: Array.isArray(raw.restrictions) ? raw.restrictions : [],
    role_description: String(raw.role_description || "Custom access profile."),
    role_template: String(raw.role_template || "custom"),
    role_title: String(raw.role_title || "Custom Role"),
  };
}

function hasAssignedModuleAccess(permissions: ReturnType<typeof normalizePermissionsPayload>) {
  return MODULE_IDS.some((moduleId) => permissions.modules[moduleId] !== "none");
}

function applyStaffPortalDefaults(
  permissions: ReturnType<typeof normalizePermissionsPayload>,
  businessUnitId: string | null,
) {
  const businessUnitIds = permissions.business_unit_ids.length
    ? permissions.business_unit_ids
    : businessUnitId
      ? [businessUnitId]
      : [];

  return {
    ...permissions,
    business_scope: permissions.business_scope === "all" ? "all" : "selected",
    business_unit_ids: permissions.business_scope === "all"
      ? [ALL_BUSINESSES_ACCESS]
      : businessUnitIds,
    expectations:
      permissions.expectations ||
      "Use Staff Hub to review your own profile, earnings, performance, role expectations, and assigned business.",
    modules: {
      ...permissions.modules,
      staff_hub: "view",
    },
    responsibilities: permissions.responsibilities.length
      ? permissions.responsibilities
      : [
          "Review your Staff Hub updates",
          "Keep your staff profile details accurate",
          "Check your payroll and performance history",
          "Check your assigned business and role expectations",
          "Report schedule, profile, or access issues to management",
        ],
    restrictions: permissions.restrictions.length
      ? permissions.restrictions
      : [
          "No payroll editing.",
          "No access management.",
          "No business settings changes.",
          "No deleting or changing other staff records.",
        ],
    role_description:
      permissions.role_description === "Custom access profile."
        ? "Staff-only login for Staff Hub with personal payroll and performance history."
        : permissions.role_description,
    role_template: "staff_portal",
    role_title: "Staff Portal",
  };
}

function legacyAccessPermission(profile: { role?: string | null } | null) {
  const role = String(profile?.role || "").trim().toLowerCase();
  return role === "admin" || role === "owner" ? "admin" : "none";
}

function hasPermission(profile: { active?: boolean | null; email?: string | null; permissions?: unknown; role?: string | null } | null, minimum: string) {
  if (normalizeEmail(profile?.email) === OWNER_EMAIL) return true;
  if (!profile?.active) return false;

  const permission = profile.permissions === null
    ? legacyAccessPermission(profile)
    : normalizePermission(normalizePermissionsPayload(profile.permissions).modules.access);
  const levels = ["none", "view", "edit", "admin"];
  const currentLevel = levels.indexOf(permission);
  const requiredLevel = levels.indexOf(minimum);

  return currentLevel >= requiredLevel;
}

function hasAssignedBusiness(permissions: ReturnType<typeof normalizePermissionsPayload>, businessUnitId: string | null) {
  return (
    permissions.business_scope === "all" ||
    permissions.business_unit_ids.includes(ALL_BUSINESSES_ACCESS) ||
    Boolean(businessUnitId) ||
    permissions.business_unit_ids.some((id) => id !== ALL_BUSINESSES_ACCESS)
  );
}

function getUserTypeForRole(role: string) {
  if (role === "contractor") return "contractor";
  if (role === "vendor") return "vendor";
  if (role === "admin") return "admin";
  return "employee";
}

function cleanRedirectTo(value: unknown, origin: string | null) {
  const configuredAppUrl =
    Deno.env.get("RTB_OS_PUBLIC_URL") ||
    Deno.env.get("SITE_URL") ||
    Deno.env.get("APP_URL") ||
    "https://rtbheadquaters.com/";
  const fallback = configuredAppUrl.endsWith("/") ? configuredAppUrl : `${configuredAppUrl}/`;
  const raw = String(value || origin || fallback);

  try {
    const url = new URL(raw);
    const allowedOrigins = new Set([
      "http://localhost:5173",
      "https://rtbheadquaters.com",
      "https://www.rtbheadquaters.com",
    ]);
    allowedOrigins.add(new URL(fallback).origin);

    return allowedOrigins.has(url.origin) ? url.origin : fallback;
  } catch (_err) {
    return fallback;
  }
}

async function requireAdmin(admin: ReturnType<typeof createClient>, req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return { error: "Missing authorization.", status: 401 };
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return { error: "Invalid authorization.", status: 401 };
  }

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("id,email,active,permissions,role")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!hasPermission(profile, "admin")) {
    return { error: "Only admins can invite team members.", status: 403 };
  }

  return { user: authData.user };
}

async function findUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    const found = data.users.find((user) => normalizeEmail(user.email) === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    const admin = getAdminClient();
    const adminCheck = await requireAdmin(admin, req);
    if ("error" in adminCheck) {
      return jsonResponse({ error: adminCheck.error }, adminCheck.status);
    }

    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const fullName = String(body.full_name || email).trim();
    const role = String(body.role || "staff").trim().toLowerCase();
    const businessUnitId = body.business_unit_id ? String(body.business_unit_id) : null;
    let permissions = normalizePermissionsPayload(body.permissions);
    const onboardingRequired =
      Boolean(body.onboarding_required) || permissions.role_template === "onboarding_restricted";
    let onboardingTargetPermissions = normalizePermissionsPayload(body.onboarding_target_permissions);
    const redirectTo = cleanRedirectTo(body.redirectTo, req.headers.get("Origin"));

    if (role === "staff" && !hasAssignedModuleAccess(permissions)) {
      permissions = applyStaffPortalDefaults(permissions, businessUnitId);
    }

    if (!hasAssignedModuleAccess(onboardingTargetPermissions)) {
      onboardingTargetPermissions = applyStaffPortalDefaults(onboardingTargetPermissions, businessUnitId);
    }

    if (!email || !email.includes("@")) {
      return jsonResponse({ error: "Enter a valid email address." }, 400);
    }

    if (!ROLE_VALUES.has(role)) {
      return jsonResponse({ error: "Choose a valid role." }, 400);
    }

    if (email !== OWNER_EMAIL && !hasAssignedBusiness(permissions, businessUnitId)) {
      return jsonResponse({ error: "Choose at least one business for this user." }, 400);
    }

    if (onboardingRequired && !businessUnitId) {
      return jsonResponse({ error: "Choose one primary business for onboarding." }, 400);
    }

    let invited = false;
    let targetUser = await findUserByEmail(admin, email);

    if (!targetUser) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo,
      });

      if (error) throw error;
      targetUser = data.user;
      invited = true;
    }

    if (!targetUser?.id) {
      throw new Error("Supabase did not return an invited user.");
    }

    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .upsert(
        {
          active: Boolean(body.active),
          business_unit_id: businessUnitId,
          email,
          full_name: fullName || email,
          id: targetUser.id,
          permissions,
          expectations: permissions.expectations || null,
          responsibilities: permissions.responsibilities,
          restrictions: permissions.restrictions,
          role_description: permissions.role_description,
          role_title: permissions.role_title,
          role,
          user_type: getUserTypeForRole(role),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      )
      .select()
      .single();

    if (profileError) throw profileError;

    if (onboardingRequired && businessUnitId) {
      const { error: onboardingError } = await admin
        .from("staff_onboarding_invitations")
        .upsert(
          {
            availability_notes: String(body.availability_notes || ""),
            business_unit_id: businessUnitId,
            email,
            full_name: fullName || email,
            position_title: body.position_title ? String(body.position_title) : null,
            required_documents: Array.isArray(body.required_documents) ? body.required_documents : [],
            staff_id: body.staff_id || null,
            start_date: body.start_date || null,
            status: "invited",
            target_permissions: onboardingTargetPermissions,
            target_role_template: onboardingTargetPermissions.role_template || "staff_portal",
            user_profile_id: targetUser.id,
          },
          { onConflict: "user_profile_id" },
        );

      if (onboardingError) throw onboardingError;
    }

    return jsonResponse({ invited, profile });
  } catch (err) {
    return jsonResponse({ error: err.message || "Unable to invite team member." }, 400);
  }
});
