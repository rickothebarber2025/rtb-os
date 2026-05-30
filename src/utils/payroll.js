import {
  ADJUSTED_COMMISSION_RATE,
  ENTRY_DEDUCTION,
  LOW_SALES_THRESHOLD,
} from './constants';

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
  const takeHome = roundMoney(commissionAmount + tipAmount - ENTRY_DEDUCTION);

  return {
    adjusted,
    appliedCommissionRate: appliedRate,
    commissionAmount,
    deduction: ENTRY_DEDUCTION,
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
    deduction: ENTRY_DEDUCTION,
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
    deduction: ENTRY_DEDUCTION,
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
