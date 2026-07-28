import {
  ADJUSTED_COMMISSION_RATE,
  ENTRY_DEDUCTION,
  FIXED_RATE_LOW_SALES_ADJUSTMENT,
  LOW_SALES_THRESHOLD,
} from './constants.js';

const COMMISSION_FLOOR = LOW_SALES_THRESHOLD;
const DEFAULT_MONTHLY_GOAL = 5000;

export const STAFF_HUB_COMMISSION_TIERS = [
  { label: 'Probation', rule: '50/50', note: 'First 90 days' },
  { label: 'Standard RTB', rule: '60/40', note: 'After probation' },
  { label: 'Performance Review', rule: '55/45', note: 'If standards drop' },
  { label: 'Growth Performer', rule: '65/35', note: 'Management approval' },
  { label: 'Elite RTB', rule: '70/30 max', note: 'Top performers' },
];

const TIER_LABELS = {
  elite: 'Elite RTB Tier',
  growth: 'Growth Performer Tier',
  performance: 'Performance Review Tier',
  performance_review: 'Performance Review Tier',
  probation: 'Probation Tier',
  review: 'Performance Review Tier',
  standard: 'Standard RTB Tier',
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function percent(value, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((safeNumber(value) / safeNumber(total)) * 100)));
}

function parseDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDate(left, right) {
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (!leftDate || !rightDate) return false;
  return leftDate.toISOString().slice(0, 10) === rightDate.toISOString().slice(0, 10);
}

function sameMonth(value, anchorDate) {
  const date = parseDate(value);
  const anchor = parseDate(anchorDate);
  if (!date || !anchor) return false;
  return date.getUTCFullYear() === anchor.getUTCFullYear() && date.getUTCMonth() === anchor.getUTCMonth();
}

export function getDefaultMonthlyGoal() {
  return DEFAULT_MONTHLY_GOAL;
}

export function buildTodayMoneyStats({ latestEntry = null, rank = null, scheduleRows = [], today = new Date() }) {
  const todayRows = scheduleRows.filter((row) =>
    sameDate(row.date || row.start_at || row.starts_at || row.created_at, today),
  );
  const importedRevenue = todayRows.reduce(
    (total, row) => total + safeNumber(row.amount || row.total || row.net_sales || row.price),
    0,
  );

  return {
    appointmentsToday: todayRows.length,
    commissionLatest: safeNumber(latestEntry?.net_sales) * (safeNumber(latestEntry?.applied_commission_rate) / 100),
    importedRevenue,
    rank,
    tipsLatest: safeNumber(latestEntry?.tips),
  };
}

export function buildIncomeOpportunity(latestEntry = null) {
  const netSales = safeNumber(latestEntry?.net_sales);
  const appliedRate = safeNumber(latestEntry?.applied_commission_rate || latestEntry?.base_commission_rate);
  const baseRate = safeNumber(latestEntry?.base_commission_rate || appliedRate);
  const currentCommission = netSales * (appliedRate / 100);
  const floorCommission = COMMISSION_FLOOR * (baseRate / 100);
  const needToFloor = Math.max(0, COMMISSION_FLOOR - netSales);
  const potentialExtraCommission = needToFloor > 0 ? Math.max(0, floorCommission - currentCommission) : 0;

  return {
    achievedFloor: needToFloor === 0 && Boolean(latestEntry),
    currentCommission: money(currentCommission),
    floor: COMMISSION_FLOOR,
    needToFloor: money(needToFloor),
    potentialExtraCommission: money(potentialExtraCommission),
  };
}

export function buildCommissionExplanation({ latestEntry = null, staffProfile = null } = {}) {
  const hasEntry = Boolean(latestEntry);
  const netSales = safeNumber(latestEntry?.net_sales);
  const tips = safeNumber(latestEntry?.tips);
  const deduction = safeNumber(latestEntry?.deduction, hasEntry ? ENTRY_DEDUCTION : 0);
  const baseRate = safeNumber(latestEntry?.base_commission_rate || staffProfile?.commission_rate || 0);
  const appliedRate = safeNumber(latestEntry?.applied_commission_rate || baseRate);
  const tierKey = String(latestEntry?.tier_snapshot || staffProfile?.tier || 'standard').toLowerCase();
  const fixedRate = Boolean(latestEntry?.fixed_rate_snapshot ?? staffProfile?.fixed_rate);
  const belowFloor = hasEntry && netSales < COMMISSION_FLOOR;
  const amountToFloor = belowFloor ? COMMISSION_FLOOR - netSales : 0;
  const adjusted = hasEntry && (Boolean(latestEntry?.adjusted) || appliedRate !== baseRate);
  const commissionAtAppliedRate = netSales * (appliedRate / 100);
  const commissionAtBaseRate = netSales * (baseRate / 100);
  const commissionAtFloorBaseRate = COMMISSION_FLOOR * (baseRate / 100);
  const adjustmentImpact = adjusted ? Math.max(0, commissionAtBaseRate - commissionAtAppliedRate) : 0;
  const projectedFloorGain = belowFloor
    ? Math.max(0, commissionAtFloorBaseRate - commissionAtAppliedRate)
    : 0;
  const takeHome = safeNumber(
    latestEntry?.take_home,
    commissionAtAppliedRate + tips - deduction,
  );
  const adjustmentPoints = Math.max(0, baseRate - appliedRate);
  const tierLabel = TIER_LABELS[tierKey] || `${tierKey || 'standard'} tier`;

  if (!hasEntry) {
    return {
      adjusted: false,
      adjustmentImpact: 0,
      adjustmentPoints: 0,
      amountToFloor: 0,
      appliedRate,
      baseRate,
      belowFloor: false,
      commissionAtAppliedRate: 0,
      deduction: 0,
      fixedRate,
      floor: COMMISSION_FLOOR,
      message: 'Once a payroll entry is saved, this will explain the exact commission rate and take-home calculation.',
      projectedFloorGain: 0,
      status: 'empty',
      takeHome: 0,
      tierLabel,
      title: 'Commission details will show after payroll',
    };
  }

  let title = 'Full commission protected';
  let message = `Your weekly net sales met the $${money(COMMISSION_FLOOR)} floor, so RTB OS kept your full ${baseRate}% rate.`;
  let status = 'success';

  if (belowFloor && fixedRate) {
    title = `Fixed commission lowered ${FIXED_RATE_LOW_SALES_ADJUSTMENT} points`;
    message = `Fixed-rate staff keep their custom rate at $${money(COMMISSION_FLOOR)} or more. Below the floor, RTB OS subtracts ${FIXED_RATE_LOW_SALES_ADJUSTMENT} points for that payroll entry.`;
    status = 'warning';
  } else if (belowFloor && tierKey === 'probation') {
    title = 'Probation stays at 50/50';
    message = `Probation starts at 50/50, so RTB OS does not drop it again below the $${money(COMMISSION_FLOOR)} floor.`;
    status = 'neutral';
  } else if (belowFloor && adjusted) {
    title = `Commission adjusted to ${appliedRate}%`;
    message = `Weekly net sales were below $${money(COMMISSION_FLOOR)}, so RTB OS used the ${ADJUSTED_COMMISSION_RATE}% performance review rate for this payroll entry.`;
    status = 'warning';
  } else if (belowFloor) {
    title = `Below the $${money(COMMISSION_FLOOR)} floor`;
    message = `This entry is below the floor, but your current tier already applies at ${appliedRate}%.`;
    status = 'neutral';
  }

  return {
    adjusted,
    adjustmentImpact: money(adjustmentImpact),
    adjustmentPoints: money(adjustmentPoints),
    amountToFloor: money(amountToFloor),
    appliedRate,
    baseRate,
    belowFloor,
    commissionAtAppliedRate: money(commissionAtAppliedRate),
    deduction: money(deduction),
    fixedRate,
    floor: COMMISSION_FLOOR,
    message,
    projectedFloorGain: money(projectedFloorGain),
    status,
    takeHome: money(takeHome),
    tierLabel,
    title,
  };
}

export function buildMonthlyGoalProgress({ entries = [], goal = DEFAULT_MONTHLY_GOAL, today = new Date() }) {
  const numericGoal = Math.max(0, safeNumber(goal, DEFAULT_MONTHLY_GOAL));
  const currentRevenue = entries
    .filter((entry) => sameMonth(entry.week_start || entry.created_at, today))
    .reduce((total, entry) => total + safeNumber(entry.net_sales), 0);
  const remaining = Math.max(0, numericGoal - currentRevenue);
  const anchor = parseDate(today) || new Date();
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  const daysLeft = Math.max(1, lastDay.getUTCDate() - anchor.getUTCDate() + 1);

  return {
    currentRevenue: money(currentRevenue),
    dailyNeeded: money(remaining / daysLeft),
    goal: numericGoal,
    percentComplete: percent(currentRevenue, numericGoal),
    remaining: money(remaining),
  };
}

export function buildRtbScore({ latestEntry = null, ownPerformance = null, rank = null }) {
  const weeks = safeNumber(ownPerformance?.weeks_recorded);
  if (!weeks) {
    return {
      components: [
        { label: 'Sales floor', score: 0 },
        { label: 'Tips', score: 0 },
        { label: 'Growth', score: 0 },
        { label: 'Consistency', score: 0 },
      ],
      focus: 'Save a few payroll/performance weeks before scoring this profile.',
      score: 0,
    };
  }

  const totalSales = safeNumber(ownPerformance?.total_net_sales);
  const totalTips = safeNumber(ownPerformance?.total_tips);
  const avgWeek = safeNumber(ownPerformance?.avg_weekly_net);
  const bestWeek = safeNumber(ownPerformance?.best_week_net);
  const underMinimumWeeks = safeNumber(ownPerformance?.under_minimum_weeks);
  const latestSales = safeNumber(latestEntry?.net_sales);
  const tipRate = totalSales > 0 ? (totalTips / totalSales) * 100 : 0;
  const salesFloor = Math.max(0, Math.min(30, 30 - (underMinimumWeeks / weeks) * 30));
  const tipStrength = Math.max(0, Math.min(25, (tipRate / 12) * 25));
  const growthLift = avgWeek > 0 ? Math.max(0, (bestWeek - avgWeek) / avgWeek) : 0;
  const growth = Math.max(0, Math.min(20, growthLift * 80));
  const consistency = Math.max(0, Math.min(15, weeks * 3));
  const currentMomentum = Math.max(0, Math.min(10, latestSales >= avgWeek ? 10 : percent(latestSales, avgWeek) / 10));
  const rankBonus = rank && rank <= 3 ? 5 : 0;
  const components = [
    { label: 'Sales floor', score: Math.round(salesFloor) },
    { label: 'Tips', score: Math.round(tipStrength) },
    { label: 'Growth', score: Math.round(growth) },
    { label: 'Consistency', score: Math.round(consistency + currentMomentum + rankBonus) },
  ];
  const lowest = [...components].sort((a, b) => a.score - b.score)[0];

  return {
    components,
    focus:
      lowest?.label === 'Tips'
        ? 'Focus this week: improve the client finish, recap aftercare, and make the service feel more personal.'
        : lowest?.label === 'Sales floor'
          ? 'Focus this week: protect the $500 floor with rebooking, add-ons, and one upgrade conversation per client.'
          : lowest?.label === 'Growth'
            ? 'Focus this week: repeat what created the best week and turn it into a checklist.'
            : 'Focus this week: keep the routine consistent and review numbers after the next saved payroll.',
    score: Math.max(0, Math.min(100, Math.round(components.reduce((total, item) => total + item.score, 0)))),
  };
}
