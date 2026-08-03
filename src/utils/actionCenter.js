import {
  AlertTriangle,
  BadgeDollarSign,
  CalendarClock,
  ClipboardList,
  FileWarning,
} from 'lucide-react';
import { canUsePayroll } from './access.js';
import { getProbationInfo, toDateKey as toLocalDateKey } from './probation.js';

export const ACTION_CENTER_SETTING_KEY = 'rtb_action_center';

const PRIORITY_RANK = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const CATEGORY_LABELS = {
  docs: 'Documents',
  payroll: 'Payroll',
  probation: 'Probation',
  content: 'Content',
  task: 'Task',
  time_off: 'Time off',
  warning: 'Staff warning',
};

export const ACTION_CENTER_ICONS = {
  content: FileWarning,
  docs: ClipboardList,
  payroll: BadgeDollarSign,
  probation: CalendarClock,
  task: ClipboardList,
  time_off: CalendarClock,
  warning: FileWarning,
};

export function createDefaultActionCenterState() {
  return {
    documents: [],
    warnings: [],
  };
}

export function normalizeActionCenterState(value) {
  const source = value && typeof value === 'object' ? value : {};

  return {
    documents: Array.isArray(source.documents) ? source.documents : [],
    warnings: Array.isArray(source.warnings) ? source.warnings : [],
  };
}

export function createActionId(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function toDateKey(value = new Date()) {
  return toLocalDateKey(value);
}

function daysBetween(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endUtc = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.floor((endUtc - startUtc) / 86400000);
}

function thisMonthKey(value) {
  const dateKey = String(value || '');
  const dateKeyMatch = /^(\d{4})-(\d{2})/.exec(dateKey);
  if (dateKeyMatch) return `${dateKeyMatch[1]}-${dateKeyMatch[2]}`;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

function priorityForDaysLeft(daysLeft) {
  if (daysLeft < 0) return 'urgent';
  if (daysLeft <= 5) return 'high';
  return 'medium';
}

function priorityForDueDate(dueDate, now, soonDays = 3) {
  if (!dueDate) return 'low';
  const daysLeft = daysBetween(now, dueDate);
  if (daysLeft === null) return 'low';
  if (daysLeft < 0) return 'urgent';
  if (daysLeft <= soonDays) return 'high';
  return 'medium';
}

function staffNameFor(record, staffById) {
  return staffById.get(record.staff_id)?.full_name || record.staff_name || 'Staff member';
}

function buildItem({
  actionLabel = 'Open',
  category,
  detail,
  id,
  kind = 'automatic',
  page,
  pageTarget = null,
  priority,
  resolveType = null,
  source = 'Live data',
  title,
}) {
  return {
    actionLabel,
    category,
    categoryLabel: CATEGORY_LABELS[category] || category,
    detail,
    id,
    kind,
    page,
    pageTarget,
    priority,
    resolveType,
    source,
    title,
  };
}

function buildProbationItems(staff, now) {
  return staff
    .filter((member) => member.active && member.tier === 'probation')
    .map((member) => {
      const info = getProbationInfo(member, now);
      if (info.daysLeft > 14) return null;

      return buildItem({
        actionLabel: 'Open roster',
        category: 'probation',
        detail:
          info.daysLeft < 0
            ? `${member.full_name} is ${Math.abs(info.daysLeft)} days overdue. Review or graduate them.`
            : `${member.full_name} reaches day 90 on ${info.endDateKey}.`,
        id: `probation-${member.id || member.full_name}`,
        page: 'staff',
        priority: priorityForDaysLeft(info.daysLeft),
        source: 'Roster',
        title:
          info.daysLeft < 0
            ? `${member.full_name}'s probation is overdue`
            : `${member.full_name}'s probation ends in ${plural(info.daysLeft, 'day')}`,
      });
    })
    .filter(Boolean);
}

function buildPayrollItems(payrollRuns, accessProfile) {
  if (!canUsePayroll(accessProfile)) return [];

  const drafts = payrollRuns.filter((run) => run.status === 'draft');
  if (!drafts.length) return [];

  return [
    buildItem({
      actionLabel: 'Review payroll',
      category: 'payroll',
      detail: `${drafts.map((run) => run.week_label || 'Untitled run').join(', ')} needs review before locking.`,
      id: 'payroll-drafts',
      page: 'payroll',
      priority: drafts.length > 1 ? 'high' : 'medium',
      source: 'Payroll',
      title: `${plural(drafts.length, 'payroll draft')} need review`,
    }),
  ];
}

function buildWarningItems(warnings, now) {
  const month = thisMonthKey(now);
  const activeWarnings = warnings.filter((warning) => !warning.resolved_at);
  const warningsThisMonth = activeWarnings.filter((warning) => thisMonthKey(warning.date) === month);
  const byStaff = warningsThisMonth.reduce((groups, warning) => {
    const key = warning.staff_id || warning.staff_name || 'unknown';
    const group = groups.get(key) || {
      staffName: warning.staff_name || 'Staff member',
      warnings: [],
    };
    group.warnings.push(warning);
    groups.set(key, group);
    return groups;
  }, new Map());

  return [...byStaff.values()]
    .filter((group) => group.warnings.length >= 2)
    .map((group) =>
      buildItem({
        actionLabel: 'Open roster',
        category: 'warning',
        detail: `${group.staffName} has ${group.warnings.length} active warnings recorded this month.`,
        id: `warning-${group.staffName}`,
        kind: 'manual',
        page: 'staff',
        priority: 'high',
        source: 'Manual tracker',
        title: `${group.staffName} has received ${plural(group.warnings.length, 'warning')} this month`,
      }),
    );
}

function buildDocumentItems(documents, now) {
  return documents
    .filter((document) => !document.resolved_at)
    .map((document) => {
      const daysLeft = document.due_date ? daysBetween(now, document.due_date) : null;
      const overdue = daysLeft !== null && daysLeft < 0;
      const dueSoon = daysLeft !== null && daysLeft <= 7;

      return buildItem({
        actionLabel: 'Open operations',
        category: 'docs',
        detail: `${document.staff_name || 'Staff member'} is missing ${document.document_name || 'an onboarding document'}${document.due_date ? `, due ${document.due_date}` : ''}.`,
        id: `document-${document.id}`,
        kind: 'manual',
        page: 'operations',
        priority: overdue ? 'urgent' : dueSoon ? 'high' : 'medium',
        resolveType: 'document',
        source: 'Manual tracker',
        title: `${document.staff_name || 'Staff member'} is missing onboarding documents`,
      });
    });
}

export function buildStaffTaskItems(tasks, staffById, now) {
  return tasks
    .filter((task) => task.status !== 'completed')
    .map((task) => {
      const staffName = staffNameFor(task, staffById);
      const priority = priorityForDueDate(task.due_date, now);
      const daysLeft = task.due_date ? daysBetween(now, task.due_date) : null;
      const dueText = task.due_date
        ? daysLeft < 0
          ? `overdue since ${task.due_date}`
          : `due ${task.due_date}`
        : 'no due date set';

      return buildItem({
        actionLabel: 'Open Staff Hub',
        category: 'task',
        detail: `${staffName} has "${task.title || 'an assigned task'}" ${dueText}.`,
        id: `task-${task.id}`,
        page: 'staff-hub',
        priority,
        source: 'Staff Hub',
        title:
          priority === 'urgent'
            ? `Overdue task for ${staffName}`
            : `Task needs attention for ${staffName}`,
      });
    });
}

export function buildTimeOffItems(timeOffRequests, staffById, now) {
  return timeOffRequests
    .filter((request) => request.status === 'pending')
    .map((request) => {
      const staffName = staffNameFor(request, staffById);
      const priority = priorityForDueDate(request.start_date, now, 7);
      const dateRange = request.end_date && request.end_date !== request.start_date
        ? `${request.start_date} to ${request.end_date}`
        : request.start_date;

      return buildItem({
        actionLabel: 'Review request',
        category: 'time_off',
        detail: `${staffName} requested time off for ${dateRange || 'an upcoming date'}.`,
        id: `time-off-${request.id}`,
        page: 'staff-hub',
        pageTarget: 'schedule',
        priority,
        source: 'Staff Hub',
        title: `Time off request from ${staffName}`,
      });
    });
}

export function buildContentSubmissionItems(contentSubmissions, staffById, now) {
  return contentSubmissions
    .filter((submission) => submission.status === 'pending')
    .map((submission) => {
      const staffName = staffNameFor(submission, staffById);
      const daysOpen = daysBetween(submission.created_at || now, now);
      const priority = daysOpen !== null && daysOpen > 14
        ? 'urgent'
        : daysOpen !== null && daysOpen > 7
          ? 'high'
          : 'medium';
      const contentType = submission.content_type || submission.media_type || 'content';

      return buildItem({
        actionLabel: 'Review content',
        category: 'content',
        detail: `${staffName} submitted ${contentType.replace(/_/g, ' ')} content for review.`,
        id: `content-${submission.id}`,
        page: 'staff-hub',
        priority,
        source: 'Staff Hub',
        title: `Content submission from ${staffName}`,
      });
    });
}

function matchesStaffScope(record, staffIds, businessUnitId) {
  if (businessUnitId && record.business_unit_id) {
    return record.business_unit_id === businessUnitId;
  }

  if (record.staff_id) {
    return staffIds.has(record.staff_id);
  }

  return true;
}

export function buildActionCenterItems({
  accessProfile,
  actionCenter,
  businessUnitId = null,
  contentSubmissions = [],
  payrollRuns = [],
  staff = [],
  tasks = [],
  timeOffRequests = [],
  now = new Date(),
}) {
  const state = normalizeActionCenterState(actionCenter);
  const staffIds = new Set(staff.map((member) => member.id).filter(Boolean));
  const staffById = new Map(staff.map((member) => [member.id, member]).filter(([id]) => Boolean(id)));
  const scopedWarnings = state.warnings.filter((warning) =>
    matchesStaffScope(warning, staffIds, businessUnitId),
  );
  const scopedDocuments = state.documents.filter((document) =>
    matchesStaffScope(document, staffIds, businessUnitId),
  );
  const scopedTasks = tasks.filter((task) => matchesStaffScope(task, staffIds, businessUnitId));
  const scopedTimeOffRequests = timeOffRequests.filter((request) =>
    matchesStaffScope(request, staffIds, businessUnitId),
  );
  const scopedContentSubmissions = contentSubmissions.filter((submission) =>
    matchesStaffScope(submission, staffIds, businessUnitId),
  );
  const items = [
    ...buildProbationItems(staff, now),
    ...buildPayrollItems(payrollRuns, accessProfile),
    ...buildStaffTaskItems(scopedTasks, staffById, now),
    ...buildTimeOffItems(scopedTimeOffRequests, staffById, now),
    ...buildContentSubmissionItems(scopedContentSubmissions, staffById, now),
    ...buildWarningItems(scopedWarnings, now),
    ...buildDocumentItems(scopedDocuments, now),
  ];

  return [...items].sort((a, b) => {
    const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return a.title.localeCompare(b.title);
  });
}

export function getActionCenterSummary(items) {
  return {
    total: items.length,
    urgent: items.filter((item) => item.priority === 'urgent' || item.priority === 'high').length,
    manual: items.filter((item) => item.kind === 'manual').length,
    automatic: items.filter((item) => item.kind === 'automatic').length,
  };
}

export function getPriorityIcon(category) {
  return ACTION_CENTER_ICONS[category] || AlertTriangle;
}

export function updateManualRecord(records, recordId, updater) {
  return records.map((record) => (record.id === recordId ? updater(record) : record));
}

export function unresolvedManualCount(state) {
  const normalized = normalizeActionCenterState(state);
  return (
    normalized.warnings.filter((item) => !item.resolved_at).length +
    normalized.documents.filter((item) => !item.resolved_at).length
  );
}
