import {
  ADJUSTED_COMMISSION_RATE,
  ENTRY_DEDUCTION,
  LOW_SALES_THRESHOLD,
} from './constants.js';

export function toMoneyNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function calculateEntryValues({
  baseCommissionRate,
  fixedRate,
  netSales,
  tips,
}) {
  const net = toMoneyNumber(netSales);
  const tipAmount = toMoneyNumber(tips);
  const baseRate = toMoneyNumber(baseCommissionRate || 60);
  const adjusted =
    !fixedRate && net < LOW_SALES_THRESHOLD && baseRate > ADJUSTED_COMMISSION_RATE;
  const appliedRate = adjusted ? ADJUSTED_COMMISSION_RATE : baseRate;
  const commissionAmount = roundMoney(net * (appliedRate / 100));
  const grossPay = roundMoney(commissionAmount + tipAmount);
  const deduction = roundMoney(Math.min(ENTRY_DEDUCTION, Math.max(0, grossPay)));
  const takeHome = roundMoney(grossPay - deduction);

  return {
    adjusted,
    appliedCommissionRate: appliedRate,
    commissionAmount,
    deduction,
    takeHome,
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

export function recalculateEntry(entry) {
  const calculated = calculateEntryValues({
    baseCommissionRate: entry.base_commission_rate,
    fixedRate: entry.fixed_rate_snapshot,
    netSales: entry.net_sales,
    tips: entry.tips,
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
