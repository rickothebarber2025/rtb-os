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

export function buildStaffPerformanceFeedback(performanceRows = [], staffMembers = []) {
  const staffById = new Map((staffMembers || []).map((member) => [member.id, member]));

  return (performanceRows || []).map((row) => {
    const staff = staffById.get(row.staff_id) || {};
    const name = row.full_name || staff.full_name || 'This team member';
    const role = String(row.role || staff.role || 'Staff');
    const underMinimum = Number(row.under_minimum_weeks || 0);
    const adjustedWeeks = Number(row.adjusted_weeks || 0);
    const avgWeekNet = Number(row.avg_weekly_net || 0);
    const bestWeekNet = Number(row.best_week_net || 0);
    const weeksRecorded = Number(row.weeks_recorded || 0);
    const fixedRate = Boolean(row.fixed_rate || staff.fixed_rate);
    const strongPerformance = avgWeekNet >= 900 && underMinimum === 0;
    const highPotential = bestWeekNet > avgWeekNet * 1.25 && weeksRecorded >= 3;
    const inconsistentPerformance = underMinimum > 0 || avgWeekNet < 700;

    const summary = strongPerformance
      ? `${name} is showing strong performance with consistent sales and customer service.`
      : inconsistentPerformance
      ? `${name} needs to improve weekly consistency and customer experience.`
      : `${name} is performing steadily and can grow further with clear coaching.`;

    const growthTip = strongPerformance
      ? `Encourage ${role.toLowerCase()} ${name} to mentor newer team members and share strong service habits.`
      : highPotential
      ? `Coach ${role.toLowerCase()} ${name} to turn strong weeks into a reliable monthly average.`
      : `Review goals and support ${role.toLowerCase()} ${name} with targeted coaching on service quality and sales consistency.`;

    const customerServiceTip = fixedRate
      ? `Reinforce consults, appointment timing, and add-on service suggestions to protect margins.`
      : `Focus on clear client communication, friendly check-ins, and consistent service pacing.`;

    const action = strongPerformance
      ? 'Keep recognizing good work and look for peer learning opportunities.'
      : inconsistentPerformance
      ? 'Set a short-term coaching goal and review progress after the next payroll run.'
      : 'Keep building momentum with measurable weekly improvement steps.';

    return {
      staff_id: row.staff_id,
      full_name: name,
      summary,
      growthTip,
      customerServiceTip,
      action,
      priority: strongPerformance ? 'low' : inconsistentPerformance ? 'high' : 'medium',
      underMinimum,
      avgWeekNet,
      bestWeekNet,
      weeksRecorded,
    };
  });
}
