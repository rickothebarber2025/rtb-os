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
  {
    description: 'Label only. Actual access comes from module permissions.',
    label: 'Admin',
    value: 'admin',
  },
  {
    description: 'Label only. Actual access comes from module permissions.',
    label: 'Manager',
    value: 'manager',
  },
  {
    description: 'Label only. Actual access comes from module permissions.',
    label: 'Staff',
    value: 'staff',
  },
  {
    description: 'Waiting for access setup.',
    label: 'Pending',
    value: 'pending',
  },
];

const ROLE_LABELS = ROLE_OPTIONS.reduce(
  (labels, role) => ({ ...labels, [role.value]: role.label }),
  {},
);

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || 'Custom';
}

export function isAdmin(profile) {
  return isOwnerProfile(profile) || getModulePermission(profile, 'access') === 'admin';
}

export function isManager(profile) {
  return hasAnyModulePermission(profile, 'edit');
}

export function canUseApp(profile) {
  return hasAnyModulePermission(profile, 'view');
}

export function canAccessPage(profile, pageId) {
  if (!canUseApp(profile)) return false;
  const moduleId = PAGE_MODULE_MAP[pageId] || PAGE_MODULE_MAP.dashboard;
  if (moduleId === 'profile') {
    return getEffectivePermissionsPayload(profile).role_template !== 'staff_portal';
  }
  return hasModulePermission(profile, moduleId, 'view');
}

export function getAllowedNavItems(profile) {
  return NAV_ITEMS.filter((item) => canAccessPage(profile, item.id));
}

export function canManageAccess(profile) {
  return hasModulePermission(profile, 'access', 'admin');
}

export function canManageStaff(profile) {
  return hasModulePermission(profile, 'roster', 'edit');
}

export function canDeleteStaff(profile) {
  return hasModulePermission(profile, 'roster', 'admin');
}

export function canUsePayroll(profile) {
  return hasModulePermission(profile, 'payroll', 'view');
}

export function canManagePayroll(profile) {
  return hasModulePermission(profile, 'payroll', 'edit');
}

export function canAdminPayroll(profile) {
  return hasModulePermission(profile, 'payroll', 'admin');
}

export function canManageAppointments(profile) {
  return hasModulePermission(profile, 'appointments', 'edit');
}

export function canDeleteBoothRent(profile) {
  return hasModulePermission(profile, 'booth_rent', 'admin');
}

export function canManageOperations(profile) {
  return hasModulePermission(profile, 'operations', 'edit');
}

export function canAdminOperations(profile) {
  return hasModulePermission(profile, 'operations', 'admin');
}

export function canManagePerformance(profile) {
  return hasModulePermission(profile, 'performance', 'edit');
}

export function canAdminPerformance(profile) {
  return hasModulePermission(profile, 'performance', 'admin');
}
