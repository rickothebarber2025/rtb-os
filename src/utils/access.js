import { NAV_ITEMS } from './constants.js';
import {
  getEffectivePermissionsPayload,
  getModulePermission,
  hasAnyModulePermission,
  hasModulePermission,
  isOwnerProfile,
  PAGE_MODULE_MAP,
} from '../lib/permissions.js';

export const ROLE_OPTIONS = [
  { description: 'Label only. Actual access comes from module permissions.', label: 'Admin', value: 'admin' },
  { description: 'Label only. Actual access comes from module permissions.', label: 'Manager', value: 'manager' },
  { description: 'Employee or commission team member. Actual access comes from module permissions.', label: 'Staff', value: 'staff' },
  { description: 'Independent contractor with only the assigned modules, duties, and business locations.', label: 'Contractor', value: 'contractor' },
  { description: 'External vendor with limited task, checklist, or service access.', label: 'Vendor', value: 'vendor' },
  { description: 'Waiting for access setup.', label: 'Pending', value: 'pending' },
];

const ROLE_LABELS = ROLE_OPTIONS.reduce((labels, role) => ({ ...labels, [role.value]: role.label }), {});
const HUB_ONLY_TEMPLATES = new Set(['staff_portal', 'operations_cleaning', 'onboarding_restricted']);

const OWNER_NAV_PRESENTATION = {
  access: { group: 'Control Room', label: 'Access' },
  'action-center': { group: 'Today', label: 'Action Center' },
  'ada-control': { group: 'Control Room', label: 'A.R.V.I.S. Control' },
  'ai-consultant': { group: 'Daily Ops', label: 'AI Consultant' },
  'customer-intelligence': { group: 'Client Flow', label: 'Client Signals' },
  dashboard: { group: 'Today', label: 'Command Center' },
  finance: { group: 'Team & Pay', label: 'Financial Buddy' },
  integrations: { group: 'Control Room', label: 'Connections' },
  'marketing-calendar': { group: 'Daily Ops', label: 'Marketing Calendar' },
  'my-role': { group: 'Profile', label: 'My Role' },
  operations: { group: 'Daily Ops', label: 'Daily Operations' },
  payroll: { group: 'Team & Pay', label: 'Payroll' },
  performance: { group: 'Team & Pay', label: 'Performance' },
  staff: { group: 'Team & Pay', label: 'Staff' },
  'staff-hub': { group: 'Team Comms', label: 'Staff Messages' },
  system: { group: 'Control Room', label: 'System Tools' },
  'talent-pipeline': { group: 'Team & Pay', label: 'Talent Pipeline' },
};

const MANAGER_NAV_PRESENTATION = {
  ...OWNER_NAV_PRESENTATION,
  dashboard: { group: 'Home', label: 'Manager Home' },
  'staff-hub': { group: 'Messages', label: 'Messages' },
};

const PAYROLL_NAV_PRESENTATION = {
  dashboard: { group: 'Home', label: 'Payroll Home' },
  payroll: { group: 'Team & Pay', label: 'Payroll' },
  performance: { group: 'Team & Pay', label: 'Performance' },
  staff: { group: 'Team & Pay', label: 'Staff' },
  'staff-hub': { group: 'Messages', label: 'Messages' },
  'my-role': { group: 'Profile', label: 'My Role' },
};

const STAFF_NAV_PRESENTATION = {
  'staff-hub': { group: 'Home', label: 'Home' },
  'my-role': { group: 'Profile', label: 'My Role' },
};

function getNavigationPresentation(profile) {
  const payload = getEffectivePermissionsPayload(profile);
  if (isOwnerProfile(profile)) return OWNER_NAV_PRESENTATION;
  if (payload.role_template === 'payroll_assistant') return PAYROLL_NAV_PRESENTATION;
  if (payload.role_template === 'staff_portal' || payload.role_template === 'onboarding_restricted') return STAFF_NAV_PRESENTATION;
  if (payload.role_template === 'operations_cleaning') return {
    'staff-hub': { group: 'Home', label: 'Cleaning' },
  };
  if (isManager(profile)) return MANAGER_NAV_PRESENTATION;
  return STAFF_NAV_PRESENTATION;
}

export function getRoleLabel(role) { return ROLE_LABELS[role] || 'Custom'; }
export function isAdmin(profile) { return isOwnerProfile(profile) || getModulePermission(profile, 'access') === 'admin'; }
export function isManager(profile) { return hasAnyModulePermission(profile, 'edit'); }
export function canUseApp(profile) { return hasAnyModulePermission(profile, 'view'); }

export function canAccessPage(profile, pageId) {
  if (!canUseApp(profile)) return false;
  if (pageId === 'ada-control') return isOwnerProfile(profile);
  const payload = getEffectivePermissionsPayload(profile);
  if (pageId === 'talent-pipeline') return hasModulePermission(profile, 'operations', 'view') || hasModulePermission(profile, 'roster', 'view');
  const moduleId = PAGE_MODULE_MAP[pageId] || PAGE_MODULE_MAP.dashboard;
  if (moduleId === 'profile') return !HUB_ONLY_TEMPLATES.has(payload.role_template);
  if (HUB_ONLY_TEMPLATES.has(payload.role_template) && pageId !== 'staff-hub') return false;
  return hasModulePermission(profile, moduleId, 'view');
}

export function getAllowedNavItems(profile) {
  const presentation = getNavigationPresentation(profile);
  return NAV_ITEMS
    .filter((item) => canAccessPage(profile, item.id))
    .map((item) => ({ ...item, ...(presentation[item.id] || {}) }));
}
export function canManageAccess(profile) { return hasModulePermission(profile, 'access', 'admin'); }
export function canManageStaff(profile) { return hasModulePermission(profile, 'roster', 'edit'); }
export function canDeleteStaff(profile) { return hasModulePermission(profile, 'roster', 'admin'); }
export function canUsePayroll(profile) { return hasModulePermission(profile, 'payroll', 'view'); }
export function canManagePayroll(profile) { return hasModulePermission(profile, 'payroll', 'edit'); }
export function canAdminPayroll(profile) { return hasModulePermission(profile, 'payroll', 'admin'); }
export function canManageAppointments(profile) { return hasModulePermission(profile, 'appointments', 'edit'); }
export function canDeleteBoothRent(profile) { return hasModulePermission(profile, 'booth_rent', 'admin'); }
export function canManageOperations(profile) { return hasModulePermission(profile, 'operations', 'edit'); }
export function canAdminOperations(profile) { return hasModulePermission(profile, 'operations', 'admin'); }
export function canManagePerformance(profile) { return hasModulePermission(profile, 'performance', 'edit'); }
export function canAdminPerformance(profile) { return hasModulePermission(profile, 'performance', 'admin'); }
