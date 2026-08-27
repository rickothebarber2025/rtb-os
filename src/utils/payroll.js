import {
  ADJUSTED_COMMISSION_RATE,
  ENTRY_DEDUCTION,
  FIXED_RATE_LOW_SALES_ADJUSTMENT,
  LOW_SALES_THRESHOLD,
} from './constants.js';

export function toMoneyNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function calculateEntryValues(input = {}) {
  const baseCommissionRate = input.baseCommissionRate ?? input.base_commission_rate;
  const fixedRate = input.fixedRate ?? input.fixed_rate_snapshot;
  const netSales = input.netSales ?? input.net_sales;
  const tips = input.tips;

  const net = toMoneyNumber(netSales);
  const tipAmount = toMoneyNumber(tips);
  const baseRate = toMoneyNumber(baseCommissionRate || 60);
  const lowSales = net < LOW_SALES_THRESHOLD;
  let appliedRate = baseRate;

  if (lowSales && fixedRate) {
    appliedRate = Math.max(0, baseRate - FIXED_RATE_LOW_SALES_ADJUSTMENT);
  } else if (lowSales && baseRate > ADJUSTED_COMMISSION_RATE) {
    appliedRate = ADJUSTED_COMMISSION_RATE;
  }

  const adjusted = appliedRate !== baseRate;
  const commissionAmount = roundMoney(net * (appliedRate / 100));
  const grossPay = roundMoney(commissionAmount + tipAmount);
  const deduction = roundMoney(Math.min(ENTRY_DEDUCTION, Math.max(0, grossPay)));
  const takeHome = roundMoney(grossPay - deduction);

  // Preserve the original payroll row. savePayrollDraft recalculates rows before
  // sending them to Supabase; dropping the original snake_case fields here made
  // valid sales, tips, staff ids and names silently save as zeros / "Staff".
  return {
    ...input,
    adjusted,
    appliedCommissionRate: appliedRate,
    applied_commission_rate: appliedRate,
    base_commission_rate: baseRate,
    commissionAmount,
    deduction,
    fixed_rate_snapshot: Boolean(fixedRate),
    net_sales: net,
    takeHome,
    take_home: takeHome,
    tips: tipAmount,
  };
}

export function createDraftEntry(staffMember) {
  const calculated = calculateEntryValues({
    baseCommissionRate: staffMember.commission_rate,
    fixedRate: staffMember.fixed_rate,
    netSales: 0,
    tips: 0,
  });

  return {
    adjusted: calculated.adjusted,
    applied_commission_rate: calculated.appliedCommissionRate,
    base_commission_rate: toMoneyNumber(staffMember.commission_rate || 60),
    deduction: calculated.deduction,
    fixed_rate_snapshot: Boolean(staffMember.fixed_rate),
    net_sales: 0,
    notes: '',
    paystub_status: 'pending',
    role_snapshot: staffMember.role || 'Staff',
    staff_id: staffMember.id,
    staff_name_snapshot: staffMember.full_name,
    take_home: calculated.takeHome,
    tier_snapshot: staffMember.tier || 'standard',
    tips: 0,
  };
}

export function normalizePayrollStaffName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function entryBelongsToStaff(entry, staffMember) {
  const entryId = entry?.staff_id;
  const staffId = staffMember?.id;
  if (entryId && staffId && entryId === staffId) return true;

  return (
    normalizePayrollStaffName(entry?.staff_name_snapshot) ===
    normalizePayrollStaffName(staffMember?.full_name)
  );
}

export function getMissingPayrollStaff(staffMembers, entries) {
  return (staffMembers || []).filter(
    (member) => member?.active && !(entries || []).some((entry) => entryBelongsToStaff(entry, member)),
  );
}

export function splitPayrollRunsByVoidStatus(runs) {
  const activeRuns = [];
  const voidedRuns = [];

  (runs || []).forEach((run) => {
    if (run?.status === 'voided') {
      voidedRuns.push(run);
    } else {
      activeRuns.push(run);
    }
  });

  return { activeRuns, voidedRuns };
}

function payrollRunSortTime(run) {
  const timestamp = Date.parse(run?.week_start || run?.week_end || run?.created_at || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortPayrollRunsByWeekAsc(runs) {
  return [...(runs || [])].sort((a, b) => {
    const weekDiff = payrollRunSortTime(a) - payrollRunSortTime(b);
    if (weekDiff !== 0) return weekDiff;

    return String(a?.week_label || '').localeCompare(String(b?.week_label || ''));
  });
}

export function getPayrollReplacementMap(runs) {
  const replacements = new Map();

  (runs || []).forEach((run) => {
    if (run?.corrected_from_run_id) replacements.set(run.corrected_from_run_id, run);
  });

  return replacements;
}

export function recalculateEntry(entry) {
  const calculated = calculateEntryValues({
    ...entry,
    baseCommissionRate: entry.base_commission_rate,
    fixedRate: entry.fixed_rate_snapshot,
    netSales: entry.net_sales,
  });

  return {
    ...entry,
    adjusted: calculated.adjusted,
    applied_commission_rate: calculated.appliedCommissionRate,
    deduction: calculated.deduction,
    take_home: calculated.takeHome,
  };
}

export function calculateRunTotals({ entries, ownerNetSales }) {
  const safeEntries = entries || [];
  const totalStaffNet = safeEntries.reduce(
    (total, entry) => total + toMoneyNumber(entry.net_sales),
    0,
  );
  const totalNetSales = roundMoney(toMoneyNumber(ownerNetSales) + totalStaffNet);
  const totalStaffPayout = roundMoney(
    safeEntries.reduce((total, entry) => total + toMoneyNumber(entry.take_home), 0),
  );
  const totalDeductions = roundMoney(
    safeEntries.reduce((total, entry) => total + toMoneyNumber(entry.deduction), 0),
  );
  const totalCommission = roundMoney(
    safeEntries.reduce((total, entry) => {
      const net = toMoneyNumber(entry.net_sales);
      const rate = toMoneyNumber(entry.applied_commission_rate);
      return total + net * (rate / 100);
    }, 0),
  );
  const rtbNet = roundMoney(totalNetSales - totalCommission + totalDeductions);

  return {
    rtbNet,
    totalDeductions,
    totalNetSales,
    totalStaffPayout,
  };
}

export function createCorrectionDraft(run, entries, reason) {
  const correctionEntries = (entries || []).map((entry) => {
    const {
      created_at: _createdAt,
      id: _id,
      payroll_run_id: _payrollRunId,
      ...draftEntry
    } = entry;

    return {
      ...draftEntry,
      paystub_status: 'pending',
    };
  });

  return {
    entries: correctionEntries,
    run: {
      ...run,
      corrected_from_run_id: run.id,
      id: undefined,
      notes: [run.notes, `Correction: ${reason}`].filter(Boolean).join('\n'),
      performance_saved_at: null,
      status: 'draft',
      void_reason: '',
      voided_at: null,
    },
  };
}
