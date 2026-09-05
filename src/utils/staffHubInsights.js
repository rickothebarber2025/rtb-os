import {
  ADJUSTED_COMMISSION_RATE,
  ENTRY_DEDUCTION,
  FIXED_RATE_LOW_SALES_ADJUSTMENT,
  LOW_SALES_THRESHOLD,
} from './constants.js';

const COMMISSION_FLOOR = LOW_SALES_THRESHOLD;
const DEFAULT_MONTHLY_GOAL = 5000;
const PERMISSION_LEVEL_WEIGHT = { admin: 3, edit: 2, none: 0, view: 1 };

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

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(safeNumber(value))));
}

function formatRewardMoney(value) {
  return `$${Math.round(safeNumber(value)).toLocaleString('en-US')}`;
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

function timeValue(value) {
  return parseDate(value)?.getTime() || 0;
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

function permissionAtLeast(modules = {}, moduleId, minimum = 'view') {
  return (
    (PERMISSION_LEVEL_WEIGHT[String(modules[moduleId] || 'none').toLowerCase()] || 0) >=
    (PERMISSION_LEVEL_WEIGHT[minimum] || 0)
  );
}

export function buildStaffRewardTrack({ accessPayload = {}, roleTemplate = 'staff_portal' } = {}) {
  const modules = accessPayload.modules || {};

  if (['owner', 'full_admin', 'legacy_admin'].includes(roleTemplate) || permissionAtLeast(modules, 'access', 'view')) {
    return {
      key: 'leadership',
      label: 'Leadership track',
      title: 'Shop leadership',
      tab: 'stats',
    };
  }

  if (roleTemplate === 'payroll_assistant' || permissionAtLeast(modules, 'payroll', 'edit')) {
    return {
      key: 'payroll',
      label: 'Payroll track',
      title: 'Payroll precision',
      tab: 'more',
    };
  }

  if (roleTemplate === 'operations_cleaning') {
    return {
      key: 'cleaning',
      label: 'Shop care track',
      title: 'Shop reset streak',
      tab: 'daily',
    };
  }

  if (roleTemplate === 'operations_assistant' || permissionAtLeast(modules, 'operations', 'edit')) {
    return {
      key: 'operations',
      label: 'Operations track',
      title: 'Operations closer',
      tab: 'daily',
    };
  }

  if (roleTemplate === 'appointment_coordinator' || permissionAtLeast(modules, 'appointments', 'edit')) {
    return {
      key: 'appointments',
      label: 'Front desk track',
      title: 'Schedule control',
      tab: 'schedule',
    };
  }

  if (roleTemplate === 'content_marketing') {
    return {
      key: 'content',
      label: 'Content track',
      title: 'Content momentum',
      tab: 'more',
    };
  }

  return {
    key: 'barber',
    label: 'Barber growth track',
    title: 'Client growth',
    tab: 'stats',
  };
}

function createReward({
  detail,
  id,
  nextLabel,
  progress,
  source,
  status,
  tab,
  targetLabel,
  title,
  tone = 'neutral',
  valueLabel,
}) {
  return {
    detail,
    id,
    nextLabel,
    progress: clampPercent(progress),
    source,
    status,
    tab,
    targetLabel,
    title,
    tone,
    valueLabel,
  };
}

function completedTaskTotal(tasks = [], categoryMatchers = []) {
  return tasks.filter((task) => {
    if (task.status !== 'completed') return false;
    if (!categoryMatchers.length) return true;
    const haystack = `${task.category || ''} ${task.title || ''} ${task.details || ''}`.toLowerCase();
    return categoryMatchers.some((matcher) => haystack.includes(matcher));
  }).length;
}

function approvedContentTotal(contentSubmissions = []) {
  return contentSubmissions.filter((item) => ['approved', 'published', 'completed'].includes(String(item.status || '').toLowerCase())).length;
}

function buildRoleTrackReward({
  contentSubmissions = [],
  dailyOperations = null,
  latestEntry = null,
  reviewCount = 0,
  rtbScore = null,
  scheduleRows = [],
  tasks = [],
  track,
}) {
  if (track.key === 'operations' || track.key === 'cleaning') {
    const score = safeNumber(dailyOperations?.operationsScore);
    const checklist = safeNumber(dailyOperations?.checklistCompletion);
    const status = score >= 90 || checklist >= 100 ? 'earned' : score > 0 || checklist > 0 ? 'in_progress' : 'locked';
    return createReward({
      detail: status === 'earned'
        ? 'Daily ops are clean: checklist, tasks, and shift standards are showing strong.'
        : status === 'in_progress'
          ? 'Finish today’s checklist and clear open tasks to push this higher.'
          : 'Clock in, run the checklist, or complete assigned tasks to start this track.',
      id: `role-${track.key}`,
      nextLabel: 'Open Work',
      progress: Math.max(score, checklist),
      source: 'Daily operations',
      status,
      tab: track.tab,
      targetLabel: '90+ ops score',
      title: track.title,
      tone: status === 'earned' ? 'success' : status === 'in_progress' ? 'gold' : 'neutral',
      valueLabel: score ? `${score}/100` : checklist ? `${checklist}%` : 'Not started',
    });
  }

  if (track.key === 'payroll') {
    const completed = completedTaskTotal(tasks, ['payroll', 'commission', 'deduction', 'payout']);
    const status = completed >= 3 ? 'earned' : completed > 0 ? 'in_progress' : 'locked';
    return createReward({
      detail: status === 'earned'
        ? 'Payroll support tasks are getting closed instead of sitting open.'
        : status === 'in_progress'
          ? 'Close assigned payroll checks and keep commission issues flagged.'
          : 'Assigned payroll or commission tasks will count here after completion.',
      id: 'role-payroll',
      nextLabel: 'Open Tasks',
      progress: percent(completed, 3),
      source: 'Assigned tasks',
      status,
      tab: track.tab,
      targetLabel: '3 payroll tasks',
      title: track.title,
      tone: status === 'earned' ? 'success' : status === 'in_progress' ? 'gold' : 'neutral',
      valueLabel: `${completed}/3`,
    });
  }

  if (track.key === 'appointments') {
    const rows = scheduleRows.length;
    const status = rows >= 8 ? 'earned' : rows > 0 ? 'in_progress' : 'locked';
    return createReward({
      detail: status === 'earned'
        ? 'Imported appointment rows are active and ready for schedule follow-up.'
        : status === 'in_progress'
          ? 'Keep schedule rows reviewed so no-shows and timing issues are caught early.'
          : 'Imported Booksy or Square schedule rows will start this track.',
      id: 'role-appointments',
      nextLabel: 'Open Schedule',
      progress: percent(rows, 8),
      source: 'Schedule imports',
      status,
      tab: track.tab,
      targetLabel: '8 reviewed rows',
      title: track.title,
      tone: status === 'earned' ? 'success' : status === 'in_progress' ? 'gold' : 'neutral',
      valueLabel: `${rows}/8`,
    });
  }

  if (track.key === 'content') {
    const total = approvedContentTotal(contentSubmissions) || contentSubmissions.length;
    const status = total >= 3 ? 'earned' : total > 0 ? 'in_progress' : 'locked';
    return createReward({
      detail: status === 'earned'
        ? 'Content ideas are moving through the shop instead of getting lost.'
        : status === 'in_progress'
          ? 'Submit work, client wins, or promo ideas so management can approve them.'
          : 'Approved content submissions will start this track.',
      id: 'role-content',
      nextLabel: 'Open Team',
      progress: percent(total, 3),
      source: 'Content submissions',
      status,
      tab: track.tab,
      targetLabel: '3 submissions',
      title: track.title,
      tone: status === 'earned' ? 'success' : status === 'in_progress' ? 'gold' : 'neutral',
      valueLabel: `${total}/3`,
    });
  }

  if (track.key === 'leadership') {
    const score = safeNumber(rtbScore?.score);
    const status = score >= 85 ? 'earned' : score > 0 ? 'in_progress' : 'locked';
    return createReward({
      detail: status === 'earned'
        ? 'The numbers are strong enough to make this a leadership-ready profile.'
        : status === 'in_progress'
          ? 'Raise consistency, reviews, and sales floor protection to strengthen leadership trust.'
          : 'Payroll and performance history will unlock this leadership view.',
      id: 'role-leadership',
      nextLabel: 'Open Growth',
      progress: percent(score, 85),
      source: 'RTB Score',
      status,
      tab: track.tab,
      targetLabel: '85 RTB Score',
      title: track.title,
      tone: status === 'earned' ? 'success' : status === 'in_progress' ? 'gold' : 'neutral',
      valueLabel: score ? `${score}/85` : 'Needs history',
    });
  }

  const latestSales = safeNumber(latestEntry?.net_sales);
  const status = latestSales >= COMMISSION_FLOOR || reviewCount >= 5 ? 'earned' : latestSales || reviewCount ? 'in_progress' : 'locked';
  return createReward({
    detail: status === 'earned'
      ? 'Client activity is turning into money, reviews, or both.'
      : status === 'in_progress'
        ? 'Protect the sales floor and keep asking happy clients for reviews.'
        : 'Payroll or verified review activity will start this track.',
    id: 'role-barber',
    nextLabel: 'Open Growth',
    progress: Math.max(percent(latestSales, COMMISSION_FLOOR), percent(reviewCount, 5)),
    source: 'Sales and reviews',
    status,
    tab: track.tab,
    targetLabel: `${formatRewardMoney(COMMISSION_FLOOR)} or 5 reviews`,
    title: track.title,
    tone: status === 'earned' ? 'success' : status === 'in_progress' ? 'gold' : 'neutral',
    valueLabel: latestSales ? formatRewardMoney(latestSales) : `${reviewCount}/5`,
  });
}

export function buildStaffHubRewards({
  accessPayload = {},
  contentSubmissions = [],
  dailyOperations = null,
  entries = [],
  monthlyGoal = null,
  ownActivityReviewSummary = null,
  ownPerformance = null,
  rank = null,
  roleTemplate = 'staff_portal',
  rtbScore = null,
  scheduleRows = [],
  tasks = [],
} = {}) {
  const sortedEntries = [...entries].sort(
    (a, b) => timeValue(b.week_start || b.created_at) - timeValue(a.week_start || a.created_at),
  );
  const latestEntry = sortedEntries[0] || null;
  const latestSales = safeNumber(latestEntry?.net_sales);
  const historicalBest = Math.max(0, ...sortedEntries.slice(1).map((entry) => safeNumber(entry.net_sales)));
  const bestSales = Math.max(historicalBest, safeNumber(ownPerformance?.best_week_net), latestSales);
  const hasRecordHistory = sortedEntries.length >= 2 && historicalBest > 0;
  const latestIsRecord = hasRecordHistory && latestSales >= historicalBest && latestSales > 0;
  const fiveStarReviews = safeNumber(ownActivityReviewSummary?.five_star_reviews);
  const reviewCount = safeNumber(ownActivityReviewSummary?.review_count);
  const monthlyPercent = safeNumber(monthlyGoal?.percentComplete);
  const track = buildStaffRewardTrack({ accessPayload, roleTemplate });

  const rewards = [
    createReward({
      detail: latestIsRecord
        ? 'New personal high from saved payroll history.'
        : hasRecordHistory
          ? `Beat ${formatRewardMoney(historicalBest)} to set the next personal sales record.`
          : 'Needs at least two saved payroll weeks before RTB OS can prove a real record.',
      id: 'record-sales',
      nextLabel: 'Open Money',
      progress: hasRecordHistory ? percent(latestSales, Math.max(historicalBest, 1)) : percent(sortedEntries.length, 2),
      source: 'Payroll history',
      status: latestIsRecord ? 'earned' : hasRecordHistory ? 'in_progress' : 'locked',
      tab: 'money',
      targetLabel: hasRecordHistory ? `Beat ${formatRewardMoney(historicalBest)}` : '2 payroll weeks',
      title: 'Record sales week',
      tone: latestIsRecord ? 'success' : hasRecordHistory ? 'gold' : 'neutral',
      valueLabel: latestSales ? `${formatRewardMoney(latestSales)}${bestSales ? ` best ${formatRewardMoney(bestSales)}` : ''}` : 'No week yet',
    }),
    createReward({
      detail: latestSales >= COMMISSION_FLOOR
        ? 'Latest saved week protected the full commission rate.'
        : latestEntry
          ? `${formatRewardMoney(COMMISSION_FLOOR - latestSales)} more sales protects the full rate.`
          : 'A saved payroll entry will show how close this week is to the sales floor.',
      id: 'sales-floor',
      nextLabel: 'Open Money',
      progress: percent(latestSales, COMMISSION_FLOOR),
      source: 'Latest payroll entry',
      status: latestSales >= COMMISSION_FLOOR ? 'earned' : latestEntry ? 'in_progress' : 'locked',
      tab: 'money',
      targetLabel: formatRewardMoney(COMMISSION_FLOOR),
      title: 'Commission protected',
      tone: latestSales >= COMMISSION_FLOOR ? 'success' : latestEntry ? 'gold' : 'neutral',
      valueLabel: latestEntry ? `${formatRewardMoney(latestSales)} / ${formatRewardMoney(COMMISSION_FLOOR)}` : 'Waiting',
    }),
    createReward({
      detail: fiveStarReviews >= 10
        ? 'Verified client reviews are showing real trust.'
        : reviewCount
          ? `${Math.max(0, 10 - fiveStarReviews)} more five-star reviews to reach the next shop badge.`
          : 'Verified Booksy and Google reviews will count after matching.',
      id: 'review-magnet',
      nextLabel: 'Open Growth',
      progress: percent(fiveStarReviews, 10),
      source: 'Verified reviews',
      status: fiveStarReviews >= 10 ? 'earned' : reviewCount ? 'in_progress' : 'locked',
      tab: 'stats',
      targetLabel: '10 five-star reviews',
      title: 'Review magnet',
      tone: fiveStarReviews >= 10 ? 'success' : reviewCount ? 'gold' : 'neutral',
      valueLabel: `${fiveStarReviews}/10`,
    }),
    createReward({
      detail: monthlyPercent >= 100
        ? 'Monthly revenue goal is complete.'
        : monthlyGoal
          ? `${Math.max(0, 100 - monthlyPercent)}% left to close this month.`
          : 'Set a monthly goal to turn payroll history into a target.',
      id: 'monthly-closer',
      nextLabel: 'Open Goal',
      progress: monthlyPercent,
      source: 'Monthly payroll goal',
      status: monthlyPercent >= 100 ? 'earned' : monthlyGoal ? 'in_progress' : 'locked',
      tab: 'money',
      targetLabel: monthlyGoal?.goal ? formatRewardMoney(monthlyGoal.goal) : 'Set goal',
      title: 'Monthly closer',
      tone: monthlyPercent >= 100 ? 'success' : monthlyGoal ? 'gold' : 'neutral',
      valueLabel: `${clampPercent(monthlyPercent)}%`,
    }),
    createReward({
      detail: rank && rank <= 3
        ? 'Top 3 in the selected performance view.'
        : rank
          ? 'Keep building sales, consistency, tips, and reviews to climb the board.'
          : 'Ranking appears after enough performance rows are saved.',
      id: 'leaderboard',
      nextLabel: 'Open Growth',
      progress: rank ? percent(Math.max(0, 6 - rank), 5) : 0,
      source: 'Performance summary',
      status: rank && rank <= 3 ? 'earned' : rank ? 'in_progress' : 'locked',
      tab: 'stats',
      targetLabel: 'Top 3',
      title: 'Leaderboard push',
      tone: rank && rank <= 3 ? 'success' : rank ? 'gold' : 'neutral',
      valueLabel: rank ? `#${rank}` : 'Not ranked',
    }),
    buildRoleTrackReward({
      contentSubmissions,
      dailyOperations,
      latestEntry,
      reviewCount,
      rtbScore,
      scheduleRows,
      tasks,
      track,
    }),
  ];

  const sortedRewards = rewards.sort((left, right) => {
    const statusWeight = { earned: 0, in_progress: 1, locked: 2 };
    const statusDelta = statusWeight[left.status] - statusWeight[right.status];
    if (statusDelta) return statusDelta;
    return right.progress - left.progress;
  });

  const earned = sortedRewards.filter((reward) => reward.status === 'earned');
  const inProgress = sortedRewards.filter((reward) => reward.status === 'in_progress');
  const locked = sortedRewards.filter((reward) => reward.status === 'locked');

  return {
    earned,
    headline: earned[0] || inProgress[0] || locked[0] || null,
    inProgress,
    locked,
    rewards: sortedRewards,
    roleTrack: track,
  };
}
