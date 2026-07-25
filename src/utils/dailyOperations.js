const STATUS_LABELS = {
  after_hours: 'After hours',
  busy: 'Busy',
  closed: 'Closed',
  closing: 'Closing in progress',
  open: 'Open',
  opening: 'Opening in progress',
};

const REQUEST_WEIGHT = {
  high: 2,
  low: 0,
  normal: 1,
  urgent: 3,
};

export function getTodayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function getLatestShopStatus(events = []) {
  const latest = [...events].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
  )[0];

  return {
    label: STATUS_LABELS[latest?.status] || 'Not set',
    status: latest?.status || 'closed',
    updatedAt: latest?.created_at || null,
    updatedByStaffId: latest?.staff_id || null,
  };
}

export function getTodayShift(records = [], staffId, today = getTodayKey()) {
  if (!staffId) return null;
  return (
    records.find((record) => record.staff_id === staffId && record.shift_date === today) ||
    records.find((record) => record.staff_id === staffId && ['active', 'checked_in'].includes(record.status)) ||
    null
  );
}

export function getTodaysChecklistRuns(runs = [], today = getTodayKey()) {
  return runs.filter((run) => run.run_date === today);
}

export function getChecklistCompletion(run) {
  const items = Array.isArray(run?.items) ? run.items : [];
  if (!items.length) return Number(run?.completion_percent || 0);
  const completed = items.filter((item) => item.completed).length;
  return Math.round((completed / items.length) * 100);
}

export function getOpenOperationsRequests(requests = []) {
  return requests
    .filter((request) => !['completed', 'denied', 'received'].includes(request.status))
    .sort((a, b) => {
      const priorityDelta = (REQUEST_WEIGHT[b.priority] || 0) - (REQUEST_WEIGHT[a.priority] || 0);
      if (priorityDelta) return priorityDelta;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
}

export function getUnacknowledgedPolicies(policies = [], acknowledgements = [], staffId = null) {
  const acknowledgedIds = new Set(
    acknowledgements
      .filter((ack) => !staffId || ack.staff_id === staffId)
      .map((ack) => ack.policy_id),
  );

  return policies.filter(
    (policy) => policy.requires_acknowledgement && !acknowledgedIds.has(policy.id),
  );
}

export function buildDailyOperationsSummary({
  checklistRuns = [],
  operationsRequests = [],
  policyAcknowledgements = [],
  policyDocuments = [],
  shiftRecords = [],
  shopStatusEvents = [],
  staffId = null,
  tasks = [],
  today = getTodayKey(),
} = {}) {
  const todayShift = getTodayShift(shiftRecords, staffId, today);
  const todayChecklistRuns = getTodaysChecklistRuns(checklistRuns, today);
  const openTasks = tasks.filter((task) => task.status !== 'completed');
  const completedTasks = tasks.filter((task) => task.status === 'completed');
  const overdueTasks = openTasks.filter((task) => task.due_date && task.due_date < today);
  const checklistCompletion = todayChecklistRuns.length
    ? Math.round(
        todayChecklistRuns.reduce((total, run) => total + getChecklistCompletion(run), 0) /
          todayChecklistRuns.length,
      )
    : 0;
  const shopStatus = getLatestShopStatus(shopStatusEvents);
  const openRequests = getOpenOperationsRequests(operationsRequests);
  const unacknowledgedPolicies = getUnacknowledgedPolicies(
    policyDocuments,
    policyAcknowledgements,
    staffId,
  );

  let score = 70;
  const checkedInAt = todayShift?.checked_in_at || todayShift?.actual_check_in;
  const checkedOutAt = todayShift?.checked_out_at || todayShift?.actual_check_out;
  if (checkedInAt) score += Number(todayShift.late_minutes || 0) ? -10 : 5;
  if (checkedOutAt) score += 5;
  if (todayShift?.missed_checkout) score -= 10;
  if (todayShift?.missed_shift) score -= 25;
  if (checklistCompletion >= 100) score += 10;
  if (checklistCompletion >= 50 && checklistCompletion < 100) score += 4;
  score += Math.min(10, completedTasks.length * 2);
  score -= Math.min(25, overdueTasks.length * 8);
  score -= Math.min(15, unacknowledgedPolicies.length * 3);

  return {
    checklistCompletion,
    completedTasks,
    openRequests,
    openTasks,
    operationsScore: Math.max(0, Math.min(100, score)),
    overdueTasks,
    shopStatus,
    todayChecklistRuns,
    todayShift,
    unacknowledgedPolicies,
  };
}
