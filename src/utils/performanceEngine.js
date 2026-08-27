import { LOW_SALES_THRESHOLD } from './constants.js';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(number(value));
}

export function getPerformanceStatus(score) {
  if (score >= 85) return { label: 'Elite', tone: 'success' };
  if (score >= 75) return { label: 'Strong performer', tone: 'success' };
  if (score >= 65) return { label: 'On track', tone: 'gold' };
  if (score >= 50) return { label: 'Needs attention', tone: 'warning' };
  return { label: 'Priority coaching', tone: 'danger' };
}

export function buildPerformanceScore({ attendance = {}, latestEntry = null, performance = null, rank = null } = {}) {
  if (!performance || !number(performance.weeks_recorded)) {
    return {
      score: 0,
      status: getPerformanceStatus(0),
      components: [],
      summary: 'Not enough saved performance history to score this staff member yet.',
      action: 'Save finalized payroll and attendance history before making a performance decision.',
    };
  }

  const weeks = Math.max(1, number(performance.weeks_recorded));
  const avgWeek = number(performance.avg_weekly_net);
  const bestWeek = number(performance.best_week_net);
  const latestSales = number(latestEntry?.net_sales);
  const underMinimum = number(performance.under_minimum_weeks);
  const totalSales = number(performance.total_net_sales);
  const totalTips = number(performance.total_tips);
  const shifts = number(attendance.shifts);
  const lateShifts = number(attendance.lateShifts);

  const revenue = clamp((avgWeek / LOW_SALES_THRESHOLD) * 30, 0, 30);
  const clientTipRate = totalSales > 0 ? (totalTips / totalSales) * 100 : 0;
  const client = clamp((clientTipRate / 12) * 20, 0, 20);
  const reliabilityRate = shifts ? 1 - lateShifts / shifts : Math.max(0, 1 - underMinimum / weeks);
  const reliability = clamp(reliabilityRate * 20, 0, 20);
  const growthRate = avgWeek > 0 ? (bestWeek - avgWeek) / avgWeek : 0;
  const momentum = avgWeek > 0 ? latestSales / avgWeek : 0;
  const growth = clamp((growthRate * 8) + (momentum * 7), 0, 15);
  const standardsBase = clamp((1 - underMinimum / weeks) * 10, 0, 10);
  const rankBonus = rank && rank <= 3 ? 5 : rank && rank <= 5 ? 3 : 0;
  const standards = clamp(standardsBase + rankBonus, 0, 15);

  const components = [
    { key: 'revenue', label: 'Revenue', score: round(revenue), max: 30 },
    { key: 'client', label: 'Client performance', score: round(client), max: 20 },
    { key: 'reliability', label: 'Reliability', score: round(reliability), max: 20 },
    { key: 'growth', label: 'Growth', score: round(growth), max: 15 },
    { key: 'standards', label: 'RTB standards', score: round(standards), max: 15 },
  ];
  const score = clamp(round(components.reduce((total, component) => total + component.score, 0)));
  const status = getPerformanceStatus(score);
  const weakest = [...components].sort((a, b) => (a.score / a.max) - (b.score / b.max))[0];

  const actionByKey = {
    revenue: `Protect the $${LOW_SALES_THRESHOLD} weekly floor with rebooking, add-ons, and stronger schedule utilization.`,
    client: 'Improve the client finish, aftercare conversation, reviews, and service experience.',
    reliability: lateShifts ? `Address the ${lateShifts} late arrival${lateShifts === 1 ? '' : 's'} recorded in the current attendance window.` : 'Keep attendance and weekly consistency stable.',
    growth: 'Repeat the habits from the best-performing week and turn them into a weekly routine.',
    standards: 'Review expectations with management and close the recurring below-target weeks.',
  };

  return {
    score,
    status,
    components,
    summary: `${status.label}. Average weekly sales are $${round(avgWeek).toLocaleString()} with ${underMinimum} of ${weeks} recorded week${weeks === 1 ? '' : 's'} below the floor.`,
    action: actionByKey[weakest?.key] || 'Keep performance consistent and review again after the next finalized week.',
  };
}

export function buildTeamPerformance({ attendanceByStaff = new Map(), latestEntryByStaff = new Map(), performanceSummary = [] } = {}) {
  const salesRanking = [...performanceSummary]
    .filter((row) => row.staff_id && !row.exclude_from_leaderboard)
    .sort((a, b) => number(b.total_net_sales) - number(a.total_net_sales));
  const rankByStaff = new Map(salesRanking.map((row, index) => [row.staff_id, index + 1]));

  return performanceSummary
    .filter((row) => row.staff_id)
    .map((row) => ({
      ...row,
      rank: rankByStaff.get(row.staff_id) || null,
      performanceScore: buildPerformanceScore({
        attendance: attendanceByStaff.get(row.staff_id) || {},
        latestEntry: latestEntryByStaff.get(row.staff_id) || null,
        performance: row,
        rank: rankByStaff.get(row.staff_id) || null,
      }),
    }))
    .sort((a, b) => b.performanceScore.score - a.performanceScore.score || number(b.total_net_sales) - number(a.total_net_sales))
    .map((row, index) => ({ ...row, scoreRank: index + 1 }));
}
