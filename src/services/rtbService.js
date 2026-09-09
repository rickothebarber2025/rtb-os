import { supabase } from '../lib/supabaseClient';
import {
  getEffectivePermissionsPayload,
  mergeProfilePermissionFields,
  normalizePermissionsPayload,
} from '../lib/permissions.js';
import { emitDataChanged } from '../lib/appEvents.js';
import { buildPermissionsFromTemplate } from '../lib/roleTemplates.js';
import { calculateEntryValues } from '../utils/payroll';
import { PROBATION_RATE, toDateKey } from '../utils/probation';

function requireClient() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

function requireData({ data, error }) {
  if (error) throw error;
  return data;
}

async function optionalData(promise, fallback) {
  try {
    return requireData(await promise);
  } catch (_err) {
    return fallback;
  }
}

function cleanObject(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function sourceAliasKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

const USER_PROFILE_SELECT = [
  'id',
  'email',
  'full_name',
  'role',
  'user_type',
  'active',
  'business_unit_id',
  'permissions',
  'role_title',
  'role_description',
  'responsibilities',
  'restrictions',
  'expectations',
].join(',');

const USER_PROFILE_LIST_SELECT = `${USER_PROFILE_SELECT},created_at,updated_at`;

function hydrateUserProfile(profile) {
  if (!profile) return null;
  if (profile.permissions === null || profile.permissions === undefined) return profile;
  return mergeProfilePermissionFields(profile);
}

function profileRolePayload(profile) {
  const permissions = profile.permissions === null
    ? getEffectivePermissionsPayload(profile)
    : normalizePermissionsPayload(profile.permissions);
  return {
    expectations: permissions.expectations || null,
    permissions,
    responsibilities: permissions.responsibilities,
    restrictions: permissions.restrictions,
    role_description: permissions.role_description,
    role_title: permissions.role_title,
  };
}

function applyOnboardingScope(query, businessUnitId) {
  if (!businessUnitId) return query;
  return query.eq('business_unit_id', businessUnitId);
}

async function getFunctionErrorMessage(error) {
  const response = error?.context;

  if (response?.json) {
    try {
      const body = await (response.clone ? response.clone() : response).json();
      return body?.error || body?.message || error.message;
    } catch (_err) {
      return error.message;
    }
  }

  return error?.message || 'Edge Function request failed.';
}

async function invokeFunction(name, body) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke(name, { body });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  if (data?.error) throw new Error(data.error);
  return data;
}

function getPublicFunctionUrl(name, params = null) {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!baseUrl) {
    throw new Error('Supabase is not configured. Add VITE_SUPABASE_URL.');
  }

  const url = new URL(`/functions/v1/${name}`, baseUrl);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }
  return url.toString();
}

async function parseFunctionResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    throw new Error(body?.error || body?.message || 'Request failed.');
  }
  return body;
}

export async function getBusinessUnits() {
  const client = requireClient();
  return requireData(
    await client.from('business_units').select('*').order('name', { ascending: true }),
  );
}

export async function getCurrentUserProfile(userId) {
  const client = requireClient();
  const { data, error } = await client
    .from('user_profiles')
    .select(USER_PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return hydrateUserProfile(data);
}

export async function createPendingUserProfile(user) {
  const client = requireClient();
  const fullName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    'Pending user';

  const profile = requireData(
    await client
      .from('user_profiles')
      .insert({
        active: false,
        email: user.email,
        full_name: fullName,
        id: user.id,
        ...profileRolePayload({ permissions: buildPermissionsFromTemplate('custom') }),
        role: 'pending',
      })
      .select()
      .single(),
  );
  return hydrateUserProfile(profile);
}

export async function getUserProfiles() {
  const client = requireClient();
  const profiles = requireData(
    await client
      .from('user_profiles')
      .select(USER_PROFILE_LIST_SELECT)
      .order('role', { ascending: true })
      .order('full_name', { ascending: true }),
  );
  return profiles.map(hydrateUserProfile);
}

export async function updateUserProfile(profile) {
  const client = requireClient();
  const rolePayload = profileRolePayload(profile);
  const payload = cleanObject({
    active: Boolean(profile.active),
    business_unit_id: profile.business_unit_id || null,
    full_name: profile.full_name || profile.email,
    ...rolePayload,
    role: profile.role || 'pending',
    updated_at: new Date().toISOString(),
  });

  const updated = requireData(
    await client
      .from('user_profiles')
      .update(payload)
      .eq('id', profile.id)
      .select()
      .single(),
  );
  return hydrateUserProfile(updated);
}

export async function linkUserProfile(signInProfileId, keepProfileId) {
  const result = await invokeFunction('link-user-profile', {
    keepProfileId,
    signInProfileId,
  });
  return hydrateUserProfile(result.profile);
}

export async function inviteUserProfile(invite) {
  const rolePayload = profileRolePayload(invite);
  const onboardingRequired =
    Boolean(invite.onboarding_required) ||
    normalizePermissionsPayload(rolePayload.permissions).role_template === 'onboarding_restricted';
  const onboardingTargetPermissions = normalizePermissionsPayload(
    invite.onboarding_target_permissions || buildPermissionsFromTemplate('staff_portal'),
  );
  return invokeFunction('invite-user', {
    business_unit_id: invite.business_unit_id || null,
    email: invite.email,
    full_name: invite.full_name,
    active: Boolean(invite.active),
    onboarding_required: onboardingRequired,
    onboarding_target_permissions: onboardingTargetPermissions,
    position_title: invite.position_title || null,
    start_date: invite.start_date || null,
    ...rolePayload,
    redirectTo: window.location.origin,
    role: invite.role || 'staff',
  });
}

export async function getStaff(businessUnitId, includeInactive = true) {
  const client = requireClient();
  let query = client
    .from('staff')
    .select('*')
    .eq('business_unit_id', businessUnitId)
    .order('full_name', { ascending: true });

  if (!includeInactive) {
    query = query.eq('active', true);
  }

  return requireData(await query);
}

function staffHubOperationsFallback() {
  return {
    auditLogs: [],
    checklistRuns: [],
    checklistTemplates: [],
    operationsRequests: [],
    policyAcknowledgements: [],
    policyDocuments: [],
    onboardingCertificates: [],
    onboardingInvitations: [],
    onboardingPolicySignatures: [],
    onboardingQuizAttempts: [],
    onboardingStageProgress: [],
    probationReviews: [],
    shiftNotes: [],
    shiftRecords: [],
    shopStatusEvents: [],
  };
}

export async function saveStaff(staff) {
  const client = requireClient();
  const isProbation = staff.tier === 'probation';
  const payload = cleanObject({
    active: staff.active ?? true,
    bio: staff.bio || null,
    business_location: staff.business_location || null,
    business_unit_id: staff.business_unit_id,
    commission_rate: isProbation ? PROBATION_RATE : Number(staff.commission_rate || 0),
    email: staff.email || null,
    fixed_rate: isProbation ? false : Boolean(staff.fixed_rate),
    full_name: staff.full_name,
    notes: staff.notes || null,
    phone: staff.phone || null,
    photo_url: staff.photo_url || null,
    preferred_name: staff.preferred_name || null,
    probation_end_date: staff.probation_end_date || null,
    probation_start_date: isProbation
      ? staff.probation_start_date || staff.start_date || toDateKey()
      : staff.probation_start_date || null,
    role: staff.role || 'Staff',
    services_offered: Array.isArray(staff.services_offered) ? staff.services_offered : undefined,
    social_handle: staff.social_handle || staff.instagram_handle || null,
    start_date: staff.start_date || null,
    tier: staff.tier || 'standard',
    updated_at: new Date().toISOString(),
  });

  if (staff.id) {
    const result = await client
      .from('staff')
      .update(payload)
      .eq('id', staff.id)
      .select()
      .single();
    return requireData(result);
  }

  const result = await client.from('staff').insert(payload).select().single();
  return requireData(result);
}

export async function saveStaffSourceIdentity(identity) {
  const client = requireClient();
  const payload = cleanObject({
    active: identity.active ?? true,
    business_location: identity.business_location || null,
    business_unit_id: identity.business_unit_id || null,
    metadata: identity.metadata || {},
    preferred_name: identity.preferred_name || null,
    services: Array.isArray(identity.services) ? identity.services : [],
    source: identity.source || 'booksy',
    source_display_name: identity.source_display_name || null,
    source_email: identity.source_email || null,
    source_staff_id: identity.source_staff_id || null,
    staff_id: identity.staff_id,
    updated_at: new Date().toISOString(),
  });

  const existing = requireData(
    await client
      .from('staff_source_identities')
      .select('id')
      .eq('staff_id', payload.staff_id)
      .eq('source', payload.source)
      .eq('business_unit_id', payload.business_unit_id)
      .limit(1)
      .maybeSingle(),
  );

  if (existing?.id) {
    return requireData(
      await client
        .from('staff_source_identities')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single(),
    );
  }

  return requireData(
    await client.from('staff_source_identities').insert(payload).select().single(),
  );
}

export async function saveStaffAlias(alias) {
  const client = requireClient();
  const aliasText = String(alias.alias || '').trim();
  const aliasKey = sourceAliasKey(aliasText);
  if (!aliasText || !aliasKey) return null;

  const payload = {
    alias: aliasText,
    alias_key: aliasKey,
    business_unit_id: alias.business_unit_id || null,
    source: alias.source || 'booksy',
    staff_id: alias.staff_id,
    updated_at: new Date().toISOString(),
  };
  const existing = requireData(
    await client
      .from('staff_aliases')
      .select('id')
      .eq('staff_id', payload.staff_id)
      .eq('source', payload.source)
      .eq('business_unit_id', payload.business_unit_id)
      .eq('alias_key', payload.alias_key)
      .limit(1)
      .maybeSingle(),
  );

  if (existing?.id) {
    return requireData(
      await client.from('staff_aliases').update(payload).eq('id', existing.id).select().single(),
    );
  }

  return requireData(await client.from('staff_aliases').insert(payload).select().single());
}

export async function saveMyStaffPortalProfile(profile) {
  const client = requireClient();
  const { data, error } = await client.rpc('update_my_staff_portal_profile', {
    p_profile: cleanObject({
      bio: profile.bio || null,
      phone: profile.phone || null,
      photo_url: profile.photo_url || null,
      services_offered: Array.isArray(profile.services_offered) ? profile.services_offered : [],
      social_handle: profile.social_handle || null,
    }),
  });

  if (error) throw error;
  return data;
}

export async function deactivateStaff(staffId) {
  const client = requireClient();
  return requireData(
    await client
      .from('staff')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', staffId)
      .select()
      .single(),
  );
}

async function getLinkedRecordCount(table, staffId) {
  const client = requireClient();
  const { count, error } = await client
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', staffId);

  if (error) throw error;
  return count || 0;
}

export async function deleteStaff(staffId) {
  const client = requireClient();
  const linkedRecordTables = [
    'payroll_entries',
    'performance_history',
    'staff_shift_records',
    'staff_tasks',
    'staff_time_off_requests',
    'staff_availability',
    'staff_content_submissions',
    'staff_source_identities',
    'staff_aliases',
    'operation_checklist_runs',
    'staff_attendance',
  ];

  const linkedCounts = await Promise.all(
    linkedRecordTables.map((table) => getLinkedRecordCount(table, staffId)),
  );

  if (linkedCounts.some((count) => count > 0)) {
    return deactivateStaff(staffId);
  }

  return requireData(await client.from('staff').delete().eq('id', staffId).select().single());
}

export async function getPayrollRuns(businessUnitId) {
  const client = requireClient();
  let query = client
    .from('payroll_runs')
    .select('*, entries:payroll_entries(*)')
    .order('created_at', { ascending: false });

  if (businessUnitId) query = query.eq('business_unit_id', businessUnitId);
  return requireData(await query);
}

export async function getPayrollEntries(payrollRunId) {
  const client = requireClient();
  return requireData(
    await client.from('payroll_entries').select('*').eq('payroll_run_id', payrollRunId),
  );
}

async function calculateEntries(entries) {
  const staffRows = await getStaff(null, true).catch(() => []);
  const staffMap = new Map(staffRows.map((staff) => [staff.id, staff]));

  return entries.map((entry) => {
    const staff = staffMap.get(entry.staff_id);
    return calculateEntryValues({
      ...entry,
      probation_start_date: staff?.probation_start_date || staff?.start_date || null,
    });
  });
}

function toRunPayload(run) {
  return cleanObject({
    business_unit_id: run.business_unit_id,
    created_by: run.created_by || undefined,
    notes: run.notes || null,
    owner_net_sales: Number(run.owner_net_sales || 0),
    owner_tips: Number(run.owner_tips || 0),
    rtb_net: Number(run.rtb_net || 0),
    status: run.status || 'draft',
    total_deductions: Number(run.total_deductions || 0),
    total_net_sales: Number(run.total_net_sales || 0),
    total_staff_payout: Number(run.total_staff_payout || 0),
    updated_at: new Date().toISOString(),
    week_end: run.week_end || null,
    week_label: run.week_label,
    week_start: run.week_start || null,
  });
}

function toEntryPayload(entry, payrollRunId) {
  return cleanObject({
    adjusted: Boolean(entry.adjusted),
    applied_commission_rate: Number(entry.applied_commission_rate || 0),
    base_commission_rate: Number(entry.base_commission_rate || 0),
    deduction: Number(entry.deduction ?? 5),
    fixed_rate_snapshot: Boolean(entry.fixed_rate_snapshot),
    net_sales: Number(entry.net_sales || 0),
    notes: entry.notes || null,
    payroll_run_id: payrollRunId || undefined,
    paystub_status: entry.paystub_status || 'pending',
    role_snapshot: entry.role_snapshot || null,
    staff_id: entry.staff_id || null,
    staff_name_snapshot: entry.staff_name_snapshot,
    take_home: Number(entry.take_home || 0),
    tier_snapshot: entry.tier_snapshot || null,
    tips: Number(entry.tips || 0),
  });
}

export async function savePayrollDraft(run, entries) {
  const client = requireClient();
  const calculatedEntries = await calculateEntries(entries);
  const { data, error } = await client.rpc('save_payroll_draft', {
    p_entries: calculatedEntries.map((entry) => toEntryPayload(entry)),
    p_run: {
      ...toRunPayload(run),
      id: run.id || null,
    },
  });

  if (error) throw error;
  const saved = Array.isArray(data) ? data[0] : data;

  if (run.corrected_from_run_id && saved?.id) {
    return requireData(
      await client
        .from('payroll_runs')
        .update({ corrected_from_run_id: run.corrected_from_run_id })
        .eq('id', saved.id)
        .eq('status', 'draft')
        .select()
        .single(),
    );
  }

  return saved;
}

export async function lockPayrollRun(runId) {
  const client = requireClient();
  const result = await client.rpc('lock_payroll_run', { p_run_id: runId });
  if (result.error) throw result.error;
}

export async function deletePayrollDraft(runId) {
  const client = requireClient();
  return requireData(
    await client
      .from('payroll_runs')
      .delete()
      .eq('id', runId)
      .eq('status', 'draft')
      .select()
      .single(),
  );
}

export async function createPayrollCorrection(runId, reason) {
  const client = requireClient();
  const { data, error } = await client.rpc('create_payroll_correction', {
    p_reason: reason,
    p_run_id: runId,
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function savePerformanceFromRun(runId) {
  const client = requireClient();
  const result = await client.rpc('save_performance_from_run', { p_run_id: runId });
  if (result.error) throw result.error;
}

export async function syncSquareAttendance(businessId, days = 30) {
  return invokeFunction('square-attendance-sync', { businessId, days });
}

export async function getStaffDailySales(businessUnitId, days = 14) {
  const client = requireClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = client
    .from('staff_daily_sales')
    .select('id,staff_id,business_unit_id,sale_date,net_sales,order_count')
    .gte('sale_date', since.toISOString().slice(0, 10))
    .order('sale_date', { ascending: true });

  if (businessUnitId) query = query.eq('business_unit_id', businessUnitId);

  return requireData(await query);
}

export async function getStaffAttendance(businessUnitId, days = 30) {
  const client = requireClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  let query = client
    .from('staff_attendance')
    .select('id,staff_id,business_unit_id,clock_in,clock_out,status,breaks')
    .gte('clock_in', since.toISOString())
    .order('clock_in', { ascending: false })
    .limit(500);

  if (businessUnitId) query = query.eq('business_unit_id', businessUnitId);

  return requireData(await query);
}

export async function getOperationsLeaderboards() {
  const client = requireClient();
  const businesses = await getBusinessUnits();

  const results = await Promise.all(
    businesses.map(async (business) => {
      const { data, error } = await client.rpc('get_monthly_operations_leaderboard', {
        p_business_unit_id: business.id,
        p_month: null,
      });
      if (error) throw error;
      return { business, month: data?.month || null, top: data?.top || [] };
    }),
  );

  return results;
}

export async function getTodayChecklistStatus(businessUnitId, checklistType) {
  const client = requireClient();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  let query = client
    .from('operation_checklist_runs')
    .select(
      '*,owner:staff_id(full_name),confirmed_by:final_confirmed_by(full_name),items:operation_checklist_run_items(*,completed_by:completed_by_staff_id(full_name))',
    )
    .eq('run_date', today)
    .order('scope', { ascending: true });

  if (businessUnitId) query = query.eq('business_unit_id', businessUnitId);
  if (checklistType) query = query.eq('checklist_type', checklistType);

  return requireData(await query);
}

export async function getPerformanceSummary(businessUnitId) {
  const client = requireClient();
  let query = client
    .from('staff_performance_summary')
    .select('*')
    .order('total_net_sales', { ascending: false });

  if (businessUnitId) {
    query = query.eq('business_unit_id', businessUnitId);
  }

  return requireData(await query);
}

export async function getMonthlyPerformanceSummary(businessUnitId) {
  const client = requireClient();
  let query = client
    .from('staff_monthly_performance_summary')
    .select('*')
    .order('month_start', { ascending: false })
    .order('total_net_sales', { ascending: false });

  if (businessUnitId) {
    query = query.eq('business_unit_id', businessUnitId);
  }

  return requireData(await query);
}

export async function getMyStaffPortalSummary() {
  const client = requireClient();
  const { data, error } = await client.rpc('get_my_staff_portal_summary');
  if (error) throw error;
  return data || {};
}

export async function getInstagramInsights(businessUnitId) {
  const client = requireClient();
  const { data, error } = await client
    .from('instagram_insights')
    .select('*')
    .eq('business_unit_id', businessUnitId)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAppSetting(key) {
  const record = await getAppSettingRecord(key);
  return record?.value || null;
}

export async function getAppSettingRecord(key) {
  const client = requireClient();
  const { data, error } = await client
    .from('app_settings')
    .select('key, updated_at, value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function saveAppSetting(key, value) {
  const client = requireClient();
  const { data, error } = await client
    .from('app_settings')
    .upsert({ key, updated_at: new Date().toISOString(), value }, { onConflict: 'key' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function clearAppSetting(key) {
  return saveAppSetting(key, null);
}

function applyNullableBusinessScope(query, businessUnitId) {
  if (!businessUnitId) return query;
  return query.or(`business_unit_id.is.null,business_unit_id.eq.${businessUnitId}`);
}

function applyBusinessScope(query, businessUnitId) {
  if (!businessUnitId) return query;
  return query.eq('business_unit_id', businessUnitId);
}

export async function getChecklistHistory(businessUnitId, days = 14) {
  const client = requireClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const query = client
    .from('operation_checklist_runs')
    .select(
      '*,items:operation_checklist_run_items(*,completed_by:completed_by_staff_id(full_name)),owner:staff_id(full_name),confirmed_by:final_confirmed_by(full_name)',
    )
    .gte('run_date', since.toISOString().slice(0, 10))
    .order('run_date', { ascending: false });

  if (businessUnitId) query.eq('business_unit_id', businessUnitId);
  return requireData(await query);
}

export async function getStaffHubRecords({ businessUnitId = null, staffId = null } = {}) {
  const client = requireClient();
  const [
    announcements,
    announcementReads,
    availability,
    timeOffRequests,
    tasks,
    newsletters,
    contentSubmissions,
    operations,
  ] = await Promise.all([
    requireData(
      await applyNullableBusinessScope(
        client
          .from('staff_announcements')
          .select('*')
          .is('archived_at', null)
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(80),
        businessUnitId,
      ),
    ),
    staffId
      ? requireData(
          await client
            .from('staff_announcement_reads')
            .select('*')
            .eq('staff_id', staffId),
        )
      : [],
    requireData(
      await applyBusinessScope(
        client
          .from('staff_availability')
          .select('*')
          .order('day_of_week', { ascending: true }),
        businessUnitId,
      ),
    ),
    requireData(
      await applyBusinessScope(
        client
          .from('staff_time_off_requests')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100),
        businessUnitId,
      ),
    ),
    requireData(
      await applyBusinessScope(
        client
          .from('staff_tasks')
          .select('*')
          .order('status', { ascending: false })
          .order('due_date', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(120),
        businessUnitId,
      ),
    ),
    requireData(
      await applyNullableBusinessScope(
        client
          .from('staff_newsletters')
          .select('*')
          .order('week_start', { ascending: false })
          .limit(24),
        businessUnitId,
      ),
    ),
    requireData(
      await applyBusinessScope(
        client
          .from('staff_content_submissions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(120),
        businessUnitId,
      ),
    ),
    getStaffHubOperationsRecords({ businessUnitId, staffId }),
  ]);

  return {
    announcementReads,
    announcements,
    availability,
    contentSubmissions,
    newsletters,
    ...operations,
    tasks,
    timeOffRequests,
  };
}

export async function getStaffHubOperationsRecords({ businessUnitId = null, staffId = null } = {}) {
  const client = requireClient();
  const fallback = staffHubOperationsFallback();
  const [
    shiftRecords,
    shopStatusEvents,
    checklistTemplates,
    checklistRuns,
    operationsRequests,
    policyDocuments,
    policyAcknowledgements,
    onboardingInvitations,
    onboardingStageProgress,
    onboardingQuizAttempts,
    onboardingPolicySignatures,
    onboardingCertificates,
    probationReviews,
    shiftNotes,
    auditLogs,
  ] = await Promise.all([
    optionalData(
      applyBusinessScope(
        client
          .from('staff_shift_records')
          .select('*')
          .order('shift_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(80),
        businessUnitId,
      ),
      fallback.shiftRecords,
    ),
    optionalData(
      applyBusinessScope(
        client
          .from('shop_status_events')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(40),
        businessUnitId,
      ),
      fallback.shopStatusEvents,
    ),
    optionalData(
      applyNullableBusinessScope(
        client
          .from('operation_checklist_templates')
          .select('*,items:operation_checklist_items(*)')
          .eq('active', true)
          .order('checklist_type', { ascending: true })
          .order('created_at', { ascending: true }),
        businessUnitId,
      ),
      fallback.checklistTemplates,
    ),
    optionalData(
      applyBusinessScope(
        client
          .from('operation_checklist_runs')
          .select('*,items:operation_checklist_run_items(*)')
          .order('run_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(80),
        businessUnitId,
      ),
      fallback.checklistRuns,
    ),
    optionalData(
      applyBusinessScope(
        client
          .from('staff_operations_requests')
          .select('*')
          .order('status', { ascending: true })
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(120),
        businessUnitId,
      ),
      fallback.operationsRequests,
    ),
    optionalData(
      applyNullableBusinessScope(
        client
          .from('policy_documents')
          .select('*')
          .eq('active', true)
          .order('category', { ascending: true })
          .order('updated_at', { ascending: false })
          .limit(80),
        businessUnitId,
      ),
      fallback.policyDocuments,
    ),
    staffId
      ? optionalData(
          client
            .from('policy_acknowledgements')
            .select('*')
            .eq('staff_id', staffId),
          fallback.policyAcknowledgements,
        )
      : fallback.policyAcknowledgements,
    optionalData(
      applyOnboardingScope(
        client
          .from('staff_onboarding_invitations')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(80),
        businessUnitId,
      ),
      fallback.onboardingInvitations,
    ),
    optionalData(
      applyOnboardingScope(
        client
          .from('staff_onboarding_stage_progress')
          .select('*')
          .order('created_at', { ascending: true }),
        businessUnitId,
      ),
      fallback.onboardingStageProgress,
    ),
    optionalData(
      applyOnboardingScope(
        client
          .from('staff_onboarding_quiz_attempts')
          .select('*')
          .order('attempted_at', { ascending: false }),
        businessUnitId,
      ),
      fallback.onboardingQuizAttempts,
    ),
    optionalData(
      applyOnboardingScope(
        client
          .from('staff_onboarding_policy_signatures')
          .select('*')
          .order('signed_at', { ascending: false }),
        businessUnitId,
      ),
      fallback.onboardingPolicySignatures,
    ),
    optionalData(
      applyOnboardingScope(
        client
          .from('staff_onboarding_certificates')
          .select('*')
          .order('issued_at', { ascending: false }),
        businessUnitId,
      ),
      fallback.onboardingCertificates,
    ),
    optionalData(
      applyOnboardingScope(
        client
          .from('staff_probation_reviews')
          .select('*')
          .order('scheduled_date', { ascending: true }),
        businessUnitId,
      ),
      fallback.probationReviews,
    ),
    optionalData(
      applyBusinessScope(
        client
          .from('shift_notes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(80),
        businessUnitId,
      ),
      fallback.shiftNotes,
    ),
    optionalData(
      applyBusinessScope(
        client
          .from('operations_audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50),
        businessUnitId,
      ),
      fallback.auditLogs,
    ),
  ]);

  return {
    auditLogs,
    checklistRuns,
    checklistTemplates: checklistTemplates.map((template) => ({
      ...template,
      items: [...(template.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    })),
    operationsRequests,
    onboardingCertificates,
    onboardingInvitations,
    onboardingPolicySignatures,
    onboardingQuizAttempts,
    onboardingStageProgress,
    policyAcknowledgements,
    policyDocuments,
    probationReviews,
    shiftNotes,
    shiftRecords,
    shopStatusEvents,
  };
}

export async function submitOnboardingStage(invitationId, stageId, metadata = {}, completed = true) {
  const client = requireClient();
  return requireData(
    await client.rpc('submit_staff_onboarding_stage', {
      p_completed: completed,
      p_invitation_id: invitationId,
      p_metadata: metadata,
      p_stage_id: stageId,
    }),
  );
}

export async function submitOnboardingQuiz(invitationId, sectionId, score, passingScore = 80, answers = {}) {
  const client = requireClient();
  return requireData(
    await client.rpc('submit_staff_onboarding_quiz', {
      p_answers: answers,
      p_invitation_id: invitationId,
      p_passing_score: passingScore,
      p_score: Number(score || 0),
      p_section_id: sectionId,
    }),
  );
}

export async function signOnboardingPolicy(invitationId, policyId, signerName, signatureText) {
  const client = requireClient();
  return requireData(
    await client.rpc('sign_staff_onboarding_policy', {
      p_invitation_id: invitationId,
      p_policy_id: policyId,
      p_signature_text: signatureText,
      p_signer_name: signerName,
    }),
  );
}

export async function submitOnboardingForApproval(invitationId) {
  const client = requireClient();
  return requireData(
    await client.rpc('submit_staff_onboarding_for_approval', {
      p_invitation_id: invitationId,
    }),
  );
}

export async function approveStaffOnboarding(invitationId, permissions, role = 'staff', managerNote = '') {
  const client = requireClient();
  return requireData(
    await client.rpc('approve_staff_onboarding', {
      p_invitation_id: invitationId,
      p_manager_note: managerNote || null,
      p_permissions: normalizePermissionsPayload(permissions),
      p_role: role,
    }),
  );
}

export async function closeStaffOnboarding(invitationId, status, reason = '') {
  const client = requireClient();
  return requireData(
    await client.rpc('close_staff_onboarding', {
      p_invitation_id: invitationId,
      p_reason: reason || null,
      p_status: status,
    }),
  );
}

export async function saveStaffProbationReview(reviewId, staffKpis, rtbSupportKpis, managerNotes = '', recommendation = '', status = 'completed') {
  const client = requireClient();
  return requireData(
    await client.rpc('save_staff_probation_review', {
      p_manager_notes: managerNotes || null,
      p_recommendation: recommendation || null,
      p_review_id: reviewId,
      p_rtb_support_kpis: rtbSupportKpis || {},
      p_staff_kpis: staffKpis || {},
      p_status: status,
    }),
  );
}

export async function saveStaffShiftRecord(record) {
  const client = requireClient();
  const payload = cleanObject({
    checked_in_at: record.checked_in_at || null,
    checked_out_at: record.checked_out_at || null,
    after_hours_reason: record.after_hours_reason || null,
    after_hours_minutes: Number(record.after_hours_minutes || 0),
    break_minutes: Number(record.break_minutes || 0),
    business_unit_id: record.business_unit_id,
    correction_note: record.correction_note || record.edit_reason || null,
    edit_reason: record.edit_reason || null,
    early_leave_minutes: Number(record.early_leave_minutes || 0),
    grace_minutes: Number(record.grace_minutes ?? 5),
    late_minutes: Number(record.late_minutes || 0),
    missed_checkout: Boolean(record.missed_checkout),
    missed_shift: Boolean(record.missed_shift),
    overtime_minutes: Number(record.overtime_minutes || 0),
    scheduled_end: record.scheduled_end || null,
    scheduled_start: record.scheduled_start || null,
    shift_date: record.shift_date || new Date().toISOString().slice(0, 10),
    staff_id: record.staff_id,
    status: record.status || 'scheduled',
    updated_at: new Date().toISOString(),
  });

  if (record.id) {
    return requireData(
      await client.from('staff_shift_records').update(payload).eq('id', record.id).select().single(),
    );
  }

  return requireData(
    await client
      .from('staff_shift_records')
      .upsert(payload, { onConflict: 'business_unit_id,staff_id,shift_date' })
      .select()
      .single(),
  );
}

export async function saveShopStatusEvent(record) {
  const client = requireClient();
  return requireData(
    await client
      .from('shop_status_events')
      .insert({
        business_unit_id: record.business_unit_id,
        note: record.note || null,
        staff_id: record.staff_id || null,
        status: record.status,
      })
      .select()
      .single(),
  );
}

export async function saveChecklistRun() {
  throw new Error('Checklist runs must be created through claimMyOperationChecklist.');
}

export async function updateChecklistRunItem() {
  throw new Error('Checklist items must be updated through setMyOperationItem.');
}

export async function saveStaffOperationsRequest(record) {
  const client = requireClient();
  const payload = cleanObject({
    assigned_to: record.assigned_to || null,
    business_unit_id: record.business_unit_id,
    category: record.category || 'general',
    details: record.details || null,
    manager_note: record.manager_note || null,
    photo_urls: Array.isArray(record.photo_urls) ? record.photo_urls : [],
    priority: record.priority || 'normal',
    request_type: record.request_type || 'maintenance',
    resolved_at: record.status === 'completed' ? new Date().toISOString() : record.resolved_at || null,
    staff_id: record.staff_id || null,
    status: record.status || 'pending',
    title: record.title,
    updated_at: new Date().toISOString(),
  });

  if (record.id) {
    return requireData(
      await client.from('staff_operations_requests').update(payload).eq('id', record.id).select().single(),
    );
  }

  return requireData(await client.from('staff_operations_requests').insert(payload).select().single());
}

export async function savePolicyDocument(record) {
  const client = requireClient();
  const payload = cleanObject({
    active: record.active ?? true,
    body: record.body,
    business_unit_id: record.business_unit_id || null,
    category: record.category || 'policy',
    requires_acknowledgement: record.requires_acknowledgement ?? true,
    title: record.title,
    updated_at: new Date().toISOString(),
    version: record.version || '1.0',
  });

  if (record.id) {
    return requireData(
      await client.from('policy_documents').update(payload).eq('id', record.id).select().single(),
    );
  }

  return requireData(await client.from('policy_documents').insert(payload).select().single());
}

export async function acknowledgePolicyDocument(policyId, staffId) {
  const client = requireClient();
  return requireData(
    await client
      .from('policy_acknowledgements')
      .upsert(
        {
          acknowledged_at: new Date().toISOString(),
          policy_id: policyId,
          staff_id: staffId,
        },
        { onConflict: 'policy_id,staff_id' },
      )
      .select()
      .single(),
  );
}

export async function saveShiftNote(record) {
  const client = requireClient();
  return requireData(
    await client
      .from('shift_notes')
      .insert({
        business_unit_id: record.business_unit_id,
        note: record.note,
        shift_date: record.shift_date || new Date().toISOString().slice(0, 10),
        staff_id: record.staff_id || null,
        visibility: record.visibility || 'team',
      })
      .select()
      .single(),
  );
}

export async function saveStaffAnnouncement(record) {
  const client = requireClient();
  const payload = cleanObject({
    body: record.body,
    business_unit_id: record.business_unit_id || null,
    category: record.category || 'reminder',
    created_by: record.id ? undefined : record.created_by || undefined,
    pinned: Boolean(record.pinned),
    title: record.title,
    updated_at: new Date().toISOString(),
  });

  if (record.id) {
    const saved = requireData(
      await client
        .from('staff_announcements')
        .update(payload)
        .eq('id', record.id)
        .select()
        .single(),
    );
    emitDataChanged('staff-announcement-updated', { announcementId: saved.id, businessUnitId: saved.business_unit_id });
    return saved;
  }

  const saved = requireData(await client.from('staff_announcements').insert(payload).select().single());
  emitDataChanged('staff-announcement-created', { announcementId: saved.id, businessUnitId: saved.business_unit_id });
  return saved;
}

export async function archiveStaffAnnouncement(announcementId, userId = null) {
  const client = requireClient();
  const payload = cleanObject({
    archived_at: new Date().toISOString(),
    archived_by: userId || undefined,
    updated_at: new Date().toISOString(),
  });
  const saved = requireData(
    await client
      .from('staff_announcements')
      .update(payload)
      .eq('id', announcementId)
      .select()
      .single(),
  );
  emitDataChanged('staff-announcement-archived', { announcementId, businessUnitId: saved.business_unit_id });
  return saved;
}

export async function markStaffAnnouncementRead(announcementId, staffId) {
  const client = requireClient();
  return requireData(
    await client
      .from('staff_announcement_reads')
      .upsert(
        {
          announcement_id: announcementId,
          read_at: new Date().toISOString(),
          staff_id: staffId,
        },
        { onConflict: 'announcement_id,staff_id' },
      )
      .select()
      .single(),
  );
}

export async function saveStaffAvailability(record) {
  const client = requireClient();
  const payload = cleanObject({
    business_unit_id: record.business_unit_id || null,
    day_of_week: Number(record.day_of_week),
    end_time: record.unavailable ? null : record.end_time || null,
    note: record.note || null,
    staff_id: record.staff_id,
    start_time: record.unavailable ? null : record.start_time || null,
    unavailable: Boolean(record.unavailable),
    updated_at: new Date().toISOString(),
  });

  return requireData(
    await client
      .from('staff_availability')
      .upsert(payload, { onConflict: 'staff_id,day_of_week' })
      .select()
      .single(),
  );
}

export async function saveTimeOffRequest(record) {
  const client = requireClient();
  const payload = cleanObject({
    business_unit_id: record.business_unit_id || null,
    end_date: record.end_date,
    reason: record.reason || null,
    staff_id: record.staff_id,
    start_date: record.start_date,
    status: record.status || 'pending',
  });

  if (record.id) {
    return requireData(
      await client.from('staff_time_off_requests').update(payload).eq('id', record.id).select().single(),
    );
  }

  return requireData(await client.from('staff_time_off_requests').insert(payload).select().single());
}

export async function decideTimeOffRequest(recordId, status, adminNote = '') {
  const client = requireClient();
  return requireData(
    await client
      .from('staff_time_off_requests')
      .update({
        admin_note: adminNote || null,
        decided_at: new Date().toISOString(),
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recordId)
      .select()
      .single(),
  );
}

export async function saveStaffTask(record) {
  const client = requireClient();
  const payload = cleanObject({
    business_unit_id: record.business_unit_id || null,
    category: record.category || 'general',
    details: record.details || null,
    due_date: record.due_date || null,
    staff_id: record.staff_id,
    status: record.status || 'pending',
    title: record.title,
    updated_at: new Date().toISOString(),
  });

  if (record.id) {
    return requireData(
      await client.from('staff_tasks').update(payload).eq('id', record.id).select().single(),
    );
  }

  return requireData(await client.from('staff_tasks').insert(payload).select().single());
}

export async function updateStaffTaskStatus(taskId, status) {
  const client = requireClient();
  return requireData(
    await client
      .from('staff_tasks')
      .update({
        completed_at: status === 'completed' ? new Date().toISOString() : null,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .select()
      .single(),
  );
}

export async function saveStaffNewsletter(record) {
  const client = requireClient();
  const payload = cleanObject({
    business_unit_id: record.business_unit_id || null,
    client_feedback: record.client_feedback || null,
    improvements_needed: record.improvements_needed || null,
    new_services_promos: record.new_services_promos || null,
    published: Boolean(record.published),
    reminders: record.reminders || null,
    top_performer_id: record.top_performer_id || null,
    top_performer_note: record.top_performer_note || null,
    updated_at: new Date().toISOString(),
    week_start: record.week_start,
    weekly_goals: record.weekly_goals || null,
  });

  if (record.id) {
    return requireData(
      await client
        .from('staff_newsletters')
        .update(payload)
        .eq('id', record.id)
        .select()
        .single(),
    );
  }

  return requireData(
    await client
      .from('staff_newsletters')
      .upsert(payload, { onConflict: 'business_unit_id,week_start' })
      .select()
      .single(),
  );
}

export async function saveContentSubmission(record) {
  const client = requireClient();
  const payload = cleanObject({
    business_unit_id: record.business_unit_id || null,
    caption: record.caption || null,
    content_type: record.content_type || 'work',
    media_type: record.media_type || 'idea',
    media_url: record.media_url || null,
    staff_id: record.staff_id,
    status: record.status || 'pending',
    updated_at: new Date().toISOString(),
  });

  if (record.id) {
    return requireData(
      await client
        .from('staff_content_submissions')
        .update(payload)
        .eq('id', record.id)
        .select()
        .single(),
    );
  }

  return requireData(
    await client.from('staff_content_submissions').insert(payload).select().single(),
  );
}

export async function decideContentSubmission(recordId, status, adminNote = '') {
  const client = requireClient();
  return requireData(
    await client
      .from('staff_content_submissions')
      .update({
        admin_note: adminNote || null,
        reviewed_at: new Date().toISOString(),
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recordId)
      .select()
      .single(),
  );
}

export async function startSquareConnection(businessUnitId) {
  return invokeFunction('square-appointments', {
    action: 'start',
    businessUnitId,
  });
}

export async function getSquareStatus(businessUnitId) {
  return invokeFunction('square-appointments', {
    action: 'status',
    businessUnitId,
  });
}

export async function syncSquareAppointments(businessUnitId, options = {}) {
  return invokeFunction('square-appointments', {
    action: 'sync',
    businessUnitId,
    endDate: options.endDate,
    startDate: options.startDate,
  });
}

export async function getPublicFeedbackSurvey(token) {
  const response = await fetch(getPublicFunctionUrl('feedback-public', { token }), {
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    },
  });

  return parseFunctionResponse(response);
}

export async function submitPublicFeedbackSurvey(token, surveyResponse) {
  const response = await fetch(getPublicFunctionUrl('feedback-public'), {
    body: JSON.stringify({ response: surveyResponse, token }),
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  return parseFunctionResponse(response);
}

export async function createFeedbackRequest(request) {
  return invokeFunction('feedback-admin', {
    action: 'create-request',
    request,
  });
}

export async function dispatchDueFeedbackRequests(businessId = null) {
  return invokeFunction('feedback-admin', {
    action: 'dispatch-due',
    businessId,
  });
}

export async function expireOldFeedbackRequests(businessId = null) {
  return invokeFunction('feedback-admin', {
    action: 'expire-old',
    businessId,
  });
}

export async function processFeedbackQueue(businessId = null, maxJobs = 5) {
  return invokeFunction('feedback-worker', {
    action: 'process',
    businessId,
    maxJobs,
  });
}

export async function runBusinessConsultantAnalysis(businessId) {
  return invokeFunction('feedback-worker', {
    action: 'consultant-report',
    businessId,
  });
}

export async function runStaffPerformanceCoaching(businessId) {
  return invokeFunction('feedback-worker', {
    action: 'staff-coaching',
    businessId,
  });
}

export async function askBusinessAssistant(businessId, question) {
  return invokeFunction('feedback-worker', {
    action: 'ask',
    businessId,
    question,
  });
}

export async function draftBusinessNewsletter(businessId, weekStart) {
  return invokeFunction('feedback-worker', {
    action: 'draft-newsletter',
    businessId,
    weekStart,
  });
}

export async function createHubTaskFromAssistant(businessId, task) {
  return invokeFunction('feedback-worker', {
    action: 'create-hub-task',
    businessId,
    category: task.category,
    details: task.details,
    dueDate: task.dueDate,
    staffId: task.staffId,
    title: task.title,
  });
}

export async function syncBooksyGmail(businessUnitId, options = {}) {
  return invokeFunction('booksy-gmail-sync', {
    ...options,
    businessUnitId,
  });
}

export async function reconcileBooksyCsvRows(businessUnitId, rows, options = {}) {
  return invokeFunction('booksy-csv-reconcile', {
    ...options,
    businessUnitId,
    rows,
  });
}

export async function syncGoogleBusinessReviews(businessUnitId, options = {}) {
  return invokeFunction('google-reviews-sync', {
    ...options,
    businessUnitId,
  });
}

export async function syncRankingCoachReviews(businessUnitId, options = {}) {
  return invokeFunction('rankingcoach-review-sync', {
    ...options,
    businessUnitId,
  });
}

export async function resolveAttributionItem(itemId, action, staffId = null, note = '') {
  const client = requireClient();
  return requireData(
    await client.rpc('resolve_assignment_item', {
      p_action: action,
      p_note: note || null,
      p_staff_id: staffId || null,
      p_unresolved_item_id: itemId,
    }),
  );
}

export async function getStaffActivityReviewSummary(businessUnitId = null) {
  const client = requireClient();
  const query = scopedByBusiness(
    client.from('staff_activity_review_summary').select('*'),
    'business_unit_id',
    businessUnitId,
  );
  return requireData(await query);
}

function scopedByBusiness(query, field, businessUnitId) {
  return businessUnitId ? query.eq(field, businessUnitId) : query;
}

export async function getFeedbackDashboard(businessUnitId = null) {
  const client = requireClient();
  const summaryQuery = scopedByBusiness(
    client.from('customer_feedback_summary').select('*'),
    'business_id',
    businessUnitId,
  );
  const feedbackQuery = scopedByBusiness(
    client
      .from('customer_feedback_enriched')
      .select('*')
      .order('request_created_at', { ascending: false })
      .limit(150),
    'business_id',
    businessUnitId,
  );
  const requestsQuery = scopedByBusiness(
    client
      .from('feedback_requests')
      .select('id,business_id,staff_id,service_name,customer_name,customer_email,customer_phone,status,send_after,sent_at,completed_at,expires_at,created_at')
      .order('created_at', { ascending: false })
      .limit(150),
    'business_id',
    businessUnitId,
  );
  const projectsQuery = scopedByBusiness(
    client
      .from('business_improvement_projects')
      .select('*,tasks:business_improvement_tasks(*)')
      .order('updated_at', { ascending: false })
      .limit(100),
    'business_id',
    businessUnitId,
  );
  const recurringQuery = scopedByBusiness(
    client
      .from('feedback_recurring_issues')
      .select('*')
      .order('mention_count', { ascending: false }),
    'business_id',
    businessUnitId,
  );
  const attributionQueueQuery = scopedByBusiness(
    client
      .from('attribution_review_queue')
      .select('*')
      .eq('status', 'unresolved')
      .order('created_at', { ascending: false })
      .limit(100),
    'business_unit_id',
    businessUnitId,
  );
  const sourceReviewsQuery = scopedByBusiness(
    client
      .from('reviews')
      .select('id,business_unit_id,staff_id,source,reviewer_name,customer_name,rating,review_text,source_timestamp,published_at,location,service_name,assignment_status,assignment_confidence,assignment_reason')
      .order('source_timestamp', { ascending: false, nullsFirst: false })
      .limit(100),
    'business_unit_id',
    businessUnitId,
  );
  const staffActivitySummaryQuery = scopedByBusiness(
    client.from('staff_activity_review_summary').select('*'),
    'business_unit_id',
    businessUnitId,
  );
  const syncRunsQuery = scopedByBusiness(
    client
      .from('sync_runs')
      .select('*')
      .in('source', ['booksy_gmail', 'booksy_csv', 'google_business_profile'])
      .order('started_at', { ascending: false })
      .limit(25),
    'business_unit_id',
    businessUnitId,
  );

  const [
    summary,
    feedback,
    requests,
    projects,
    recurringIssues,
    attributionQueue,
    sourceReviews,
    staffActivitySummary,
    syncRuns,
  ] = await Promise.all([
    requireData(await summaryQuery),
    requireData(await feedbackQuery),
    requireData(await requestsQuery),
    requireData(await projectsQuery),
    requireData(await recurringQuery),
    optionalData(attributionQueueQuery, []),
    optionalData(sourceReviewsQuery, []),
    optionalData(staffActivitySummaryQuery, []),
    optionalData(syncRunsQuery, []),
  ]);

  return {
    attributionQueue,
    feedback,
    projects,
    recurringIssues,
    requests,
    sourceReviews,
    staffActivitySummary,
    summary: businessUnitId ? summary[0] || null : null,
    summaries: summary,
    syncRuns,
  };
}

export async function getBusinessConsultantData(businessUnitId = null) {
  const client = requireClient();
  const sourcesQuery = scopedByBusiness(
    client
      .from('business_intelligence_sources')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(150),
    'business_id',
    businessUnitId,
  );
  const reportsQuery = scopedByBusiness(
    client
      .from('ai_business_consultant_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20),
    'business_id',
    businessUnitId,
  );
  const dashboard = await getFeedbackDashboard(businessUnitId);
  const [sources, reports] = await Promise.all([
    requireData(await sourcesQuery),
    requireData(await reportsQuery),
  ]);

  return {
    ...dashboard,
    latestReport: reports[0] || null,
    reports,
    sources,
  };
}

export async function saveBusinessIntelligenceSource(source) {
  const client = requireClient();
  const payload = cleanObject({
    body: source.body,
    business_id: source.business_id,
    metadata: source.metadata || {},
    source_date: source.source_date || null,
    source_type: source.source_type || 'other',
    title: source.title,
    updated_at: new Date().toISOString(),
  });

  if (source.id) {
    return requireData(
      await client
        .from('business_intelligence_sources')
        .update(payload)
        .eq('id', source.id)
        .select()
        .single(),
    );
  }

  return requireData(
    await client
      .from('business_intelligence_sources')
      .insert(payload)
      .select()
      .single(),
  );
}

export async function deleteBusinessIntelligenceSource(sourceId) {
  const client = requireClient();
  return requireData(
    await client.from('business_intelligence_sources').delete().eq('id', sourceId),
  );
}

export async function updateImprovementProject(projectId, updates) {
  const client = requireClient();
  return requireData(
    await client
      .from('business_improvement_projects')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', projectId)
      .select('*,tasks:business_improvement_tasks(*)')
      .single(),
  );
}

export async function updateImprovementTask(taskId, updates) {
  const client = requireClient();
  const payload = {
    ...updates,
    completed_at: updates.status === 'done' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  return requireData(
    await client
      .from('business_improvement_tasks')
      .update(payload)
      .eq('id', taskId)
      .select()
      .single(),
  );
}
