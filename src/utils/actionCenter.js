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
  warning: 'Staff warning',
};

export const ACTION_CENTER_ICONS = {
  docs: ClipboardList,
  payroll: BadgeDollarSign,
  probation: CalendarClock,
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

function buildItem({
  actionLabel = 'Open',
  category,
  detail,
  id,
  kind = 'automatic',
  page,
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
  payrollRuns = [],
  staff = [],
  now = new Date(),
}) {
  const state = normalizeActionCenterState(actionCenter);
  const staffIds = new Set(staff.map((member) => member.id).filter(Boolean));
  const scopedWarnings = state.warnings.filter((warning) =>
    matchesStaffScope(warning, staffIds, businessUnitId),
  );
  const scopedDocuments = state.documents.filter((document) =>
    matchesStaffScope(document, staffIds, businessUnitId),
  );
  const items = [
    ...buildProbationItems(staff, now),
    ...buildPayrollItems(payrollRuns, accessProfile),
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
