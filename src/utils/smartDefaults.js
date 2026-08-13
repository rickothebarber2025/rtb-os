import { getEffectivePermissionsPayload, hasAllBusinessAccess, isOwnerProfile } from '../lib/permissions.js';
import { ALL_BUSINESSES_ID } from './businessProfiles.js';

export const SMART_DEFAULTS_VERSION = 1;

export function getRoleTemplate(profile) {
  return getEffectivePermissionsPayload(profile).role_template || 'custom';
}

export function isOperationsCleaningProfile(profile) {
  return getRoleTemplate(profile) === 'operations_cleaning';
}

export function getSmartBusinessUnitId({ businessOptions = [], profile, storedBusinessUnitId = '' }) {
  const optionIds = new Set(businessOptions.map((unit) => unit.id));
  const template = getRoleTemplate(profile);

  if (template === 'operations_cleaning' && hasAllBusinessAccess(profile) && optionIds.has(ALL_BUSINESSES_ID)) {
    return ALL_BUSINESSES_ID;
  }

  if (storedBusinessUnitId && optionIds.has(storedBusinessUnitId)) return storedBusinessUnitId;

  if (!isOwnerProfile(profile) && profile?.business_unit_id && optionIds.has(profile.business_unit_id)) {
    return profile.business_unit_id;
  }

  if (isOwnerProfile(profile) && optionIds.has(ALL_BUSINESSES_ID)) return ALL_BUSINESSES_ID;

  return businessOptions[0]?.id || '';
}

export function getSmartLandingPage({ profile, navItems = [], signals = {} }) {
  const allowed = new Set(navItems.map((item) => item.id));
  const template = getRoleTemplate(profile);

  if ((template === 'operations_cleaning' || template === 'staff_portal') && allowed.has('staff-hub')) {
    return 'staff-hub';
  }

  if (signals.pendingAccessCount > 0 && allowed.has('access')) return 'access';
  if (signals.urgentActionCount > 0 && allowed.has('action-center')) return 'action-center';
  if (signals.draftPayrollCount > 0 && allowed.has('payroll')) return 'payroll';
  if (allowed.has('dashboard')) return 'dashboard';
  if (allowed.has('staff-hub')) return 'staff-hub';
  return navItems[0]?.id || 'my-role';
}

export function getSmartStaffHubTab({ profile, staffHub = {}, now = new Date() }) {
  const template = getRoleTemplate(profile);
  if (template === 'operations_cleaning') return 'daily';

  const checklistRuns = Array.isArray(staffHub.checklistRuns) ? staffHub.checklistRuns : [];
  const tasks = Array.isArray(staffHub.tasks) ? staffHub.tasks : [];
  const today = now.toISOString().slice(0, 10);
  const unfinishedToday = checklistRuns.some((run) => {
    const date = String(run.run_date || run.date || '').slice(0, 10);
    return date === today && Number(run.completion_percent || 0) < 100;
  });
  const overdueTask = tasks.some((task) => task.status !== 'completed' && task.due_date && task.due_date < today);

  if (unfinishedToday || overdueTask) return 'daily';
  return 'home';
}

export function getSmartChecklistType({ runs = [], now = new Date() }) {
  const unfinished = runs
    .filter((run) => ['opening', 'closing'].includes(run.type || run.checklist_type))
    .filter((run) => Number(run.completion_percent || 0) < 100 && !run.final_confirmed_at)
    .sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime());

  if (unfinished.length) return unfinished[0].type || unfinished[0].checklist_type;
  return now.getHours() >= 15 ? 'closing' : 'opening';
}

export function getSmartChecklistView({ profile, runs = [] }) {
  if (isOperationsCleaningProfile(profile)) return 'cleaning';
  const unfinishedShared = runs.some(
    (run) => run.scope === 'shared' && Number(run.completion_percent || 0) < 100 && !run.final_confirmed_at,
  );
  const unfinishedStation = runs.some(
    (run) => run.scope === 'station' && Number(run.completion_percent || 0) < 100 && !run.final_confirmed_at,
  );
  if (unfinishedStation) return 'station';
  if (unfinishedShared) return 'shared';
  return 'station';
}

export function getSmartCategoryExpansion(items = []) {
  const groups = items.reduce((result, item) => {
    const category = item.category || 'General';
    result[category] ||= [];
    result[category].push(item);
    return result;
  }, {});

  const entries = Object.entries(groups);
  const firstIncomplete = entries.find(([, rows]) => rows.some((item) => item.status === 'pending'))?.[0];
  return Object.fromEntries(entries.map(([category]) => [category, category === firstIncomplete]));
}

export function getNextBestChecklistItem(items = []) {
  return items.find((item) => item.required && item.status === 'pending') || items.find((item) => item.status === 'pending') || null;
}
