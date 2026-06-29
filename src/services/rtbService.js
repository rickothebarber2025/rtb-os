import { supabase } from '../lib/supabaseClient';
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

function cleanObject(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
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
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function createPendingUserProfile(user) {
  const client = requireClient();
  const fullName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    'Pending user';

  return requireData(
    await client
      .from('user_profiles')
      .insert({
        active: false,
        email: user.email,
        full_name: fullName,
        id: user.id,
        role: 'pending',
      })
      .select()
      .single(),
  );
}

export async function getUserProfiles() {
  const client = requireClient();
  return requireData(
    await client
      .from('user_profiles')
      .select('*')
      .order('role', { ascending: true })
      .order('full_name', { ascending: true }),
  );
}

export async function updateUserProfile(profile) {
  const client = requireClient();
  const payload = cleanObject({
    active: Boolean(profile.active),
    business_unit_id: profile.business_unit_id || null,
    full_name: profile.full_name || profile.email,
    role: profile.role || 'pending',
    updated_at: new Date().toISOString(),
  });

  return requireData(
    await client
      .from('user_profiles')
      .update(payload)
      .eq('id', profile.id)
      .select()
      .single(),
  );
}

export async function inviteUserProfile(invite) {
  return invokeFunction('invite-user', {
    business_unit_id: invite.business_unit_id || null,
    email: invite.email,
    full_name: invite.full_name,
    redirectTo: window.location.origin,
    role: invite.role || 'manager',
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

export async function saveStaff(staff) {
  const client = requireClient();
  const isProbation = staff.tier === 'probation';
  const payload = cleanObject({
    active: staff.active ?? true,
    business_unit_id: staff.business_unit_id,
    commission_rate: isProbation ? PROBATION_RATE : Number(staff.commission_rate || 0),
    email: staff.email || null,
    fixed_rate: isProbation ? false : Boolean(staff.fixed_rate),
    full_name: staff.full_name,
    notes: staff.notes || null,
    phone: staff.phone || null,
    probation_start_date: isProbation
      ? staff.probation_start_date || staff.start_date || toDateKey()
      : staff.probation_start_date || null,
    role: staff.role || 'Staff',
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
  const linkedCounts = await Promise.all([
    getLinkedRecordCount('payroll_entries', staffId),
    getLinkedRecordCount('performance_history', staffId),
    getLinkedRecordCount('booth_rent', staffId),
  ]);

  if (linkedCounts.some((count) => count > 0)) {
    throw new Error('This staff profile is tied to payroll, performance, or booth rent records. Deactivate it to keep history safe.');
  }

  return requireData(await client.from('staff').delete().eq('id', staffId));
}

async function getPayrollEntries(runIds) {
  const client = requireClient();
  if (!runIds.length) return [];

  return requireData(
    await client
      .from('payroll_entries')
      .select('*')
      .in('payroll_run_id', runIds)
      .order('staff_name_snapshot', { ascending: true }),
  );
}

export async function getPayrollRuns(businessUnitId) {
  const client = requireClient();
  const runs = requireData(
    await client
      .from('payroll_runs')
      .select('*')
      .eq('business_unit_id', businessUnitId)
      .order('created_at', { ascending: false }),
  );

  const entries = await getPayrollEntries(runs.map((run) => run.id));
  return runs.map((run) => ({
    ...run,
    payroll_entries: entries.filter((entry) => entry.payroll_run_id === run.id),
  }));
}

export async function calculateTakeHomeOnServer(entry) {
  const client = requireClient();
  const { data, error } = await client.rpc('calculate_staff_take_home', {
    p_base_comm: Number(entry.base_commission_rate || 0),
    p_fixed: Boolean(entry.fixed_rate_snapshot),
    p_net: Number(entry.net_sales || 0),
    p_tips: Number(entry.tips || 0),
  });

  if (error || !data?.[0]) {
    const fallback = calculateEntryValues({
      baseCommissionRate: entry.base_commission_rate,
      fixedRate: entry.fixed_rate_snapshot,
      netSales: entry.net_sales,
      tips: entry.tips,
    });

    return {
      adjusted: fallback.adjusted,
      applied_commission_rate: fallback.appliedCommissionRate,
      take_home: fallback.takeHome,
    };
  }

  return {
    adjusted: Boolean(data[0].adjusted),
    applied_commission_rate: Number(data[0].applied_commission_rate),
    take_home: Number(data[0].take_home),
  };
}

async function calculateEntries(entries) {
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      ...(await calculateTakeHomeOnServer(entry)),
      deduction: Number(entry.deduction ?? 5),
    })),
  );
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

export async function getBoothRent(businessUnitId) {
  const client = requireClient();
  return requireData(
    await client
      .from('booth_rent')
      .select('*')
      .eq('business_unit_id', businessUnitId)
      .order('created_at', { ascending: false }),
  );
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

export async function saveBoothRent(record) {
  const client = requireClient();
  const payload = cleanObject({
    business_unit_id: record.business_unit_id,
    notes: record.notes || null,
    paid: Boolean(record.paid),
    paid_at: record.paid ? record.paid_at || new Date().toISOString() : null,
    rent_amount: Number(record.rent_amount || 0),
    renter_name: record.renter_name,
    staff_id: record.staff_id || null,
    week_label: record.week_label || null,
  });

  if (record.id) {
    return requireData(
      await client.from('booth_rent').update(payload).eq('id', record.id).select().single(),
    );
  }

  return requireData(await client.from('booth_rent').insert(payload).select().single());
}

export async function toggleBoothRentPaid(record) {
  const client = requireClient();
  const paid = !record.paid;
  return requireData(
    await client
      .from('booth_rent')
      .update({ paid, paid_at: paid ? new Date().toISOString() : null })
      .eq('id', record.id)
      .select()
      .single(),
  );
}

export async function deleteBoothRent(recordId) {
  const client = requireClient();
  return requireData(await client.from('booth_rent').delete().eq('id', recordId));
}
