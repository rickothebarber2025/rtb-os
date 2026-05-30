import { supabase } from '../lib/supabaseClient';
import { calculateEntryValues } from '../utils/payroll';

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

export async function getBusinessUnits() {
  const client = requireClient();
  return requireData(
    await client.from('business_units').select('*').order('name', { ascending: true }),
  );
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
  const payload = cleanObject({
    active: staff.active ?? true,
    business_unit_id: staff.business_unit_id,
    commission_rate: Number(staff.commission_rate || 0),
    email: staff.email || null,
    fixed_rate: Boolean(staff.fixed_rate),
    full_name: staff.full_name,
    notes: staff.notes || null,
    phone: staff.phone || null,
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
      deduction: Number(entry.deduction || 5),
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
    deduction: Number(entry.deduction || 5),
    fixed_rate_snapshot: Boolean(entry.fixed_rate_snapshot),
    net_sales: Number(entry.net_sales || 0),
    notes: entry.notes || null,
    payroll_run_id: payrollRunId,
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
  const payload = toRunPayload(run);
  let savedRun;

  if (run.id) {
    savedRun = requireData(
      await client.from('payroll_runs').update(payload).eq('id', run.id).select().single(),
    );

    requireData(
      await client.from('payroll_entries').delete().eq('payroll_run_id', savedRun.id),
    );
  } else {
    savedRun = requireData(
      await client.from('payroll_runs').insert(payload).select().single(),
    );
  }

  if (calculatedEntries.length) {
    requireData(
      await client
        .from('payroll_entries')
        .insert(calculatedEntries.map((entry) => toEntryPayload(entry, savedRun.id))),
    );
  }

  return savedRun;
}

export async function lockPayrollRun(runId) {
  const client = requireClient();
  const result = await client.rpc('lock_payroll_run', { p_run_id: runId });
  if (result.error) throw result.error;
}

export async function savePerformanceFromRun(runId) {
  const client = requireClient();
  const result = await client.rpc('save_performance_from_run', { p_run_id: runId });
  if (result.error) throw result.error;
}

export async function getPerformanceSummary(businessUnitName) {
  const client = requireClient();
  let query = client
    .from('staff_performance_summary')
    .select('*')
    .order('total_net_sales', { ascending: false });

  if (businessUnitName) {
    query = query.eq('business_unit', businessUnitName);
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
  const client = requireClient();
  const { data, error } = await client
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw error;
  return data?.value || null;
}

export async function startSquareConnection(businessUnitId) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('square-appointments', {
    body: {
      action: 'start',
      businessUnitId,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function syncSquareAppointments(businessUnitId) {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('square-appointments', {
    body: {
      action: 'sync',
      businessUnitId,
    },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
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
