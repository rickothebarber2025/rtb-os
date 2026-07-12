export const SOURCE_TYPES = [
  { label: 'Google Review', value: 'google_review' },
  { label: 'Business Audit', value: 'business_audit' },
  { label: 'Uploaded Document', value: 'uploaded_document' },
  { label: 'Staff Suggestion', value: 'staff_suggestion' },
  { label: 'Meeting Note', value: 'meeting_note' },
  { label: 'Financial Report', value: 'financial_report' },
  { label: 'Incident Report', value: 'incident_report' },
  { label: 'Payroll', value: 'payroll' },
  { label: 'Staff Performance', value: 'staff_performance' },
  { label: 'Appointment Trend', value: 'appointment_trend' },
  { label: 'Booksy Import', value: 'booksy_import' },
  { label: 'Square Data', value: 'square_data' },
  { label: 'Inventory', value: 'inventory' },
  { label: 'Email Conversation', value: 'email_conversation' },
  { label: 'Other', value: 'other' },
];

export const RETURN_OPTIONS = [
  { label: 'Definitely', value: 'definitely' },
  { label: 'Probably', value: 'probably' },
  { label: 'Maybe', value: 'maybe' },
  { label: 'No', value: 'no' },
];

export const ON_TIME_OPTIONS = [
  { label: 'Yes', value: 'yes' },
  { label: 'Within 5 minutes', value: 'within_5_minutes' },
  { label: 'More than 10 minutes', value: 'more_than_10_minutes' },
];

export const EMPTY_FEEDBACK_METRICS = {
  averageRating: 0,
  customerSatisfaction: 0,
  npsScore: 0,
  responseRate: 0,
  completedResponses: 0,
  totalRequests: 0,
};

const CATEGORY_KEYWORDS = [
  ['Reception Experience', ['front', 'desk', 'reception', 'greet', 'welcome', 'check in']],
  ['Wait Time', ['late', 'wait', 'waiting', 'on time', 'delay', 'behind']],
  ['Cleanliness', ['clean', 'dirty', 'dust', 'smell', 'sanitary', 'hygiene']],
  ['Service Quality', ['service', 'lash', 'nail', 'hair', 'cut', 'fade', 'brow', 'quality']],
  ['Atmosphere', ['music', 'vibe', 'atmosphere', 'temperature', 'lighting', 'noise']],
  ['Communication', ['confusing', 'unclear', 'communication', 'explain', 'instructions']],
  ['Pricing', ['price', 'cost', 'expensive', 'charge', 'payment']],
];

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(safeNumber(value) * factor) / factor;
}

export function getSourceTypeLabel(value) {
  return SOURCE_TYPES.find((type) => type.value === value)?.label || 'Other';
}

export function calculateFeedbackMetrics({ requests = [], responses = [], summary = null }) {
  const totalRequests = safeNumber(summary?.total_requests, requests.length);
  const completedResponses = safeNumber(
    summary?.completed_responses,
    responses.filter((row) => row.feedback_response_id || row.id).length,
  );

  if (summary && completedResponses) {
    return {
      averageRating: round(summary.average_rating || 0, 2),
      completedResponses,
      customerSatisfaction: round(summary.customer_satisfaction || 0, 1),
      npsScore: round(summary.nps_score || 0, 1),
      responseRate: round(summary.response_rate || 0, 1),
      totalRequests,
    };
  }

  const completed = responses.filter((row) => row.overall_rating !== null && row.overall_rating !== undefined);
  const averageRating = completed.length
    ? completed.reduce((total, row) => total + safeNumber(row.overall_rating), 0) / completed.length
    : 0;
  const customerSatisfaction = completed.length
    ? (completed.filter((row) => safeNumber(row.overall_rating) >= 4).length / completed.length) * 100
    : 0;
  const promoters = completed.filter((row) => safeNumber(row.recommend_business) >= 9).length;
  const detractors = completed.filter((row) => safeNumber(row.recommend_business) <= 6).length;
  const npsScore = completed.length ? ((promoters - detractors) / completed.length) * 100 : 0;
  const responseRate = totalRequests ? (completedResponses / totalRequests) * 100 : 0;

  return {
    averageRating: round(averageRating, 2),
    completedResponses,
    customerSatisfaction: round(customerSatisfaction, 1),
    npsScore: round(npsScore, 1),
    responseRate: round(responseRate, 1),
    totalRequests,
  };
}

export function normalizeIssueKey(value) {
  return String(value || 'general')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

export function detectFeedbackCategory(text) {
  const haystack = String(text || '').toLowerCase();
  const match = CATEGORY_KEYWORDS.find(([, keywords]) =>
    keywords.some((keyword) => haystack.includes(keyword)),
  );
  return match?.[0] || 'Customer Experience';
}

export function priorityRank(priority) {
  return {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
  }[priority] || 0;
}

export function groupRecurringIssues(feedbackRows = []) {
  const groups = new Map();

  feedbackRows.forEach((row) => {
    const category =
      row.main_category ||
      detectFeedbackCategory(`${row.improvement_suggestion || ''} ${row.additional_comments || ''}`);
    const key = normalizeIssueKey(category);
    const current = groups.get(key) || {
      count: 0,
      examples: [],
      key,
      lastSeenAt: null,
      priority: 'low',
      suggestedAction: '',
      title: category,
    };
    const priority = row.priority || (safeNumber(row.overall_rating) <= 2 ? 'high' : 'medium');

    current.count += 1;
    current.lastSeenAt =
      !current.lastSeenAt || new Date(row.response_created_at || row.created_at || 0) > new Date(current.lastSeenAt)
        ? row.response_created_at || row.created_at
        : current.lastSeenAt;
    current.priority = priorityRank(priority) > priorityRank(current.priority) ? priority : current.priority;
    current.suggestedAction = row.suggested_action || current.suggestedAction;

    const example = row.summary || row.improvement_suggestion || row.additional_comments;
    if (example && current.examples.length < 3) current.examples.push(example);
    groups.set(key, current);
  });

  return [...groups.values()]
    .filter((issue) => issue.count >= 2 || priorityRank(issue.priority) >= 3)
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.count - a.count);
}

function uniqueText(rows, field, limit = 5) {
  const seen = new Set();
  const values = [];

  rows.forEach((row) => {
    const value = String(row[field] || '').trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
  });

  return values.slice(0, limit);
}

export function buildCustomerInsightSections(feedbackRows = [], projects = []) {
  const completed = feedbackRows.filter((row) => row.feedback_response_id || row.overall_rating);
  const positiveRows = completed.filter(
    (row) => safeNumber(row.overall_rating) >= 4 || row.sentiment === 'positive',
  );
  const negativeRows = completed.filter(
    (row) =>
      safeNumber(row.overall_rating) <= 3 ||
      ['negative', 'mixed'].includes(row.sentiment) ||
      row.appointment_started_on_time === 'more_than_10_minutes',
  );
  const recurringIssues = groupRecurringIssues(completed);
  const activeProjects = projects.filter((project) => project.status !== 'done' && project.status !== 'ignored');

  return {
    monthlyImprovements: activeProjects
      .filter((project) => project.priority === 'high' || project.priority === 'urgent')
      .slice(0, 5),
    negativeTrends: recurringIssues.slice(0, 5),
    positiveTrends: uniqueText(positiveRows, 'favorite_part', 5),
    recurringIssues,
    topComplaints: uniqueText(negativeRows, 'improvement_suggestion', 5),
    topCompliments: uniqueText(positiveRows, 'favorite_part', 5),
    weeklyImprovements: activeProjects.slice(0, 5),
  };
}

export function getProjectProgress(project) {
  const tasks = project?.tasks || [];
  if (!tasks.length) return 0;
  return round((tasks.filter((task) => task.status === 'done').length / tasks.length) * 100, 0);
}

export function buildConsultantRecommendations({ feedback = [], projects = [], sources = [] }) {
  const recurringIssues = groupRecurringIssues(feedback);
  const openProjects = projects.filter((project) => project.status !== 'done' && project.status !== 'ignored');
  const sourceThemes = sources
    .map((source) => ({
      priority: 'medium',
      title: source.title,
      sourceType: getSourceTypeLabel(source.source_type),
    }))
    .slice(0, 5);
  const problems = [
    ...recurringIssues.map((issue) => ({
      detail: `${issue.count} mentions`,
      priority: issue.priority,
      title: issue.title,
    })),
    ...openProjects.map((project) => ({
      detail: project.reason,
      priority: project.priority,
      title: project.title,
    })),
    ...sourceThemes,
  ].slice(0, 3);
  const fixFirst = problems[0]?.title || 'Collect more customer feedback before choosing a major fix.';
  const lowCostProject =
    openProjects.find((project) => String(project.estimated_cost || '').toLowerCase() === 'low') ||
    openProjects[0];
  const highRoiProject =
    openProjects.find((project) => String(project.estimated_revenue_impact || '').toLowerCase() === 'high') ||
    openProjects[0];

  return {
    biggestProblems: problems,
    delegateRecommendations: openProjects.slice(0, 3).map((project) => ({
      task: project.title,
      why: 'Assign an owner and track the tasks until complete.',
    })),
    fixFirst,
    highestRoi: highRoiProject?.title || fixFirst,
    lowestCost: lowCostProject?.title || fixFirst,
    recurringProblems: recurringIssues.slice(0, 5),
    summary:
      problems.length > 0
        ? `RTB OS found ${problems.length} priority area${problems.length === 1 ? '' : 's'} from current intelligence sources.`
        : 'Add feedback, reviews, audits, notes, or reports to generate a stronger business readout.',
  };
}

function getRoleCoaching(role) {
  const normalized = String(role || '').toLowerCase();

  if (normalized.includes('barber')) {
    return {
      revenueMove: 'pre-book the next cut before the client leaves and offer beard, lineup, or enhancement upgrades when they fit the service',
      serviceMoment: 'use a mirror check before the cape comes off and ask what they want tightened before they leave',
      tipMove: 'explain one visible detail you cleaned up so the client understands the extra care behind the finish',
    };
  }

  if (normalized.includes('hair')) {
    return {
      revenueMove: 'recommend a maintenance schedule, treatment, or style add-on tied to the client\'s hair goal',
      serviceMoment: 'explain the plan before starting and recap home care before checkout',
      tipMove: 'give one personalized product or heat-care tip that makes the client feel coached, not rushed',
    };
  }

  if (normalized.includes('nail')) {
    return {
      revenueMove: 'offer design upgrades like French, chrome, art, repair, or longer-wear options before the color is locked in',
      serviceMoment: 'confirm shape, length, and color in stages so fixes happen early instead of at checkout',
      tipMove: 'create a photo-ready reveal moment and recommend aftercare such as cuticle oil or refill timing',
    };
  }

  if (normalized.includes('lash')) {
    return {
      revenueMove: 'pre-book fills, recommend lash bath or aftercare, and explain when a fuller set protects retention',
      serviceMoment: 'do a comfort check during the appointment and explain aftercare before the client sits up',
      tipMove: 'connect the final reveal to retention tips so the client sees the value beyond the appointment',
    };
  }

  return {
    revenueMove: 'identify one repeatable add-on, pre-booking, or upgrade conversation that fits their service',
    serviceMoment: 'use a clear greeting, mid-service check-in, and checkout recap every time',
    tipMove: 'name one extra detail completed for the client so the service feels intentional',
  };
}

function moneyLabel(value) {
  return `$${Math.round(safeNumber(value)).toLocaleString('en-US')}`;
}

export function buildStaffPerformanceFeedback(performanceRows = [], staffMembers = []) {
  const staffById = new Map((staffMembers || []).map((member) => [member.id, member]));

  return (performanceRows || []).map((row) => {
    const staff = staffById.get(row.staff_id) || {};
    const name = row.full_name || staff.full_name || 'This team member';
    const role = String(row.role || staff.role || 'Staff');
    const roleLabel = role.toLowerCase();
    const roleCoaching = getRoleCoaching(role);
    const underMinimum = safeNumber(row.under_minimum_weeks);
    const adjustedWeeks = safeNumber(row.adjusted_weeks);
    const avgWeekNet = safeNumber(row.avg_weekly_net);
    const bestWeekNet = safeNumber(row.best_week_net);
    const totalNetSales = safeNumber(row.total_net_sales);
    const totalTips = safeNumber(row.total_tips);
    const weeksRecorded = safeNumber(row.weeks_recorded);
    const fixedRate = Boolean(row.fixed_rate || staff.fixed_rate);
    const tipRate = totalNetSales > 0 ? round((totalTips / totalNetSales) * 100, 1) : 0;
    const bestLift = avgWeekNet > 0 ? round(((bestWeekNet - avgWeekNet) / avgWeekNet) * 100, 0) : 0;
    const underMinimumRate = weeksRecorded > 0 ? underMinimum / weeksRecorded : 0;
    const strongSales = avgWeekNet >= 900 && underMinimum === 0;
    const lowTips = totalNetSales > 0 && tipRate < 8;
    const highTips = tipRate >= 13;
    const highPotential = bestLift >= 25 && weeksRecorded >= 3;
    const unstableFloor = underMinimum > 0 || avgWeekNet < 650;

    let summary;
    let growthTip;
    let tipTip;
    let customerServiceTip;
    let action;
    let priority = 'medium';

    if (!weeksRecorded) {
      summary = `${name} does not have enough saved performance history yet to coach from trends.`;
      growthTip = `Have ${name} track weekly sales, tips, rebooking, and add-on conversations before judging performance.`;
      tipTip = `Start with one tip habit: thank the client by name and explain the best care step before checkout.`;
      customerServiceTip = `Standardize the basics: greeting, timing, consultation, service check-in, and checkout recap.`;
      action = `Create a first baseline week for ${name}, then review the numbers before giving hard goals.`;
    } else if (unstableFloor) {
      priority = 'high';
      summary = `${name} has ${underMinimum} of ${weeksRecorded} week${weeksRecorded === 1 ? '' : 's'} under the $500 floor and averages ${moneyLabel(avgWeekNet)} per week.`;
      growthTip = `Coach ${roleLabel} ${name} to rebuild the sales floor first: ${roleCoaching.revenueMove}.`;
      tipTip = lowTips
        ? `Tips are only ${tipRate}% of sales. Bring up how they can make the client feel guided, not processed: ${roleCoaching.tipMove}.`
        : `Tips are healthier than sales. Use that client trust to ask for rebooking and one appropriate upgrade each appointment.`;
      customerServiceTip = `${roleCoaching.serviceMoment}. Then ask which part of the appointment made the client most likely to come back.`;
      action = `Set a next-payroll goal: no under-$500 week and at least ${moneyLabel(Math.max(500, avgWeekNet + 100))} in weekly sales.`;
    } else if (lowTips) {
      priority = 'medium';
      summary = `${name} is producing revenue, but tips are lagging at ${tipRate}% of sales.`;
      growthTip = `Keep the revenue routine steady while improving the parts clients reward emotionally: listening, confidence, and checkout care.`;
      tipTip = `Ask ${name} to practice this tip driver for one week: ${roleCoaching.tipMove}.`;
      customerServiceTip = `${roleCoaching.serviceMoment}. This should feel natural, not like begging for tips.`;
      action = `Review tip percentage after the next payroll run and compare it against the current ${tipRate}% baseline.`;
    } else if (highPotential) {
      priority = 'medium';
      summary = `${name}'s best week was ${moneyLabel(bestWeekNet)}, about ${bestLift}% above their ${moneyLabel(avgWeekNet)} average.`;
      growthTip = `Break down what happened in that best week: schedule quality, add-ons, repeat clients, and pre-booking. Turn the top two behaviors into a weekly checklist.`;
      tipTip = highTips
        ? `Tips are already strong at ${tipRate}%. Protect that by keeping the personal touches consistent while raising average ticket.`
        : `Use the best-week client behaviors to lift tips too: ${roleCoaching.tipMove}.`;
      customerServiceTip = `${roleCoaching.serviceMoment}. The goal is to repeat the best week, not chase random busy weeks.`;
      action = `Bring one question to the staff meeting: what exactly made ${moneyLabel(bestWeekNet)} happen, and what will be repeated this week?`;
    } else if (strongSales) {
      priority = 'low';
      summary = `${name} is strong and steady with ${moneyLabel(avgWeekNet)} average weekly sales and no under-minimum weeks.`;
      growthTip = `Use ${name} as a model for the team, but still push one revenue layer: ${roleCoaching.revenueMove}.`;
      tipTip = highTips
        ? `Tips are strong at ${tipRate}%. Ask them to share the client-service habit behind that with newer staff.`
        : `The next growth opportunity is tips. Add a more intentional finish: ${roleCoaching.tipMove}.`;
      customerServiceTip = fixedRate
        ? `Because they are fixed-rate, protect margin with timing, rebooking, and upgrade discipline.`
        : `${roleCoaching.serviceMoment}. Keep the experience consistent as volume grows.`;
      action = `Give recognition, then set a stretch goal of ${moneyLabel(avgWeekNet + 150)} average weekly sales without lowering service quality.`;
    } else {
      summary = `${name} is stable at ${moneyLabel(avgWeekNet)} average weekly sales, with room to grow revenue and tips.`;
      growthTip = `Pick one measurable growth lever for ${roleLabel} ${name}: ${roleCoaching.revenueMove}.`;
      tipTip = lowTips
        ? `Tip rate is ${tipRate}%, so coach the emotional finish: ${roleCoaching.tipMove}.`
        : `Keep tip habits steady and use trust to increase rebooking and add-on acceptance.`;
      customerServiceTip = `${roleCoaching.serviceMoment}. Track whether this improves client return behavior.`;
      action = `Set a two-week target: raise average weekly sales by ${moneyLabel(100)} or add one more upgrade/pre-booking conversation per day.`;
    }

    if (fixedRate && unstableFloor) {
      action += ' Fixed-rate staff still lose five commission points below $500, so make the floor non-negotiable.';
    }

    return {
      action,
      adjustedWeeks,
      avgWeekNet,
      bestWeekNet,
      customerServiceTip,
      fixedRate,
      full_name: name,
      growthTip,
      priority,
      staff_id: row.staff_id,
      summary,
      tipRate,
      tipTip,
      totalNetSales,
      totalTips,
      underMinimum,
      weeksRecorded,
    };
  });
}
