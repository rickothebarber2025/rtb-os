const COMMISSION_FLOOR = 500;
const DEFAULT_MONTHLY_GOAL = 5000;

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
