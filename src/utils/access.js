import { NAV_ITEMS } from './constants';

export const ROLE_OPTIONS = [
  {
    description: 'Full access to payroll, staff changes, booth rent, imports, and user access.',
    label: 'Admin',
    value: 'admin',
  },
  {
    description: 'Can manage roster, booth rent, reports, and appointment imports.',
    label: 'Manager',
    value: 'manager',
  },
  {
    description: 'Signed in, but no dashboard access yet.',
    label: 'Staff',
    value: 'staff',
  },
  {
    description: 'Waiting for an admin to activate access.',
    label: 'Pending',
    value: 'pending',
  },
];

const ROLE_LABELS = ROLE_OPTIONS.reduce(
  (labels, role) => ({ ...labels, [role.value]: role.label }),
  {},
);

const PAGE_ACCESS = {
  access: ['admin'],
  'booth-rent': ['admin', 'manager'],
  dashboard: ['admin', 'manager'],
  insights: ['admin', 'manager'],
  operations: ['admin', 'manager'],
  payroll: ['admin'],
  performance: ['admin', 'manager'],
  staff: ['admin', 'manager'],
};

export function getRoleLabel(role) {
  return ROLE_LABELS[role] || 'Pending';
}

export function isAdmin(profile) {
  return Boolean(profile?.active && profile.role === 'admin');
}

export function isManager(profile) {
  return Boolean(profile?.active && profile.role === 'manager');
}

export function canUseApp(profile) {
  return isAdmin(profile) || isManager(profile);
}

export function canAccessPage(profile, pageId) {
  if (!canUseApp(profile)) return false;
  return (PAGE_ACCESS[pageId] || PAGE_ACCESS.dashboard).includes(profile.role);
}

export function getAllowedNavItems(profile) {
  return NAV_ITEMS.filter((item) => canAccessPage(profile, item.id));
}

export function canManageAccess(profile) {
  return isAdmin(profile);
}

export function canManageStaff(profile) {
  return isAdmin(profile) || isManager(profile);
}

export function canDeleteStaff(profile) {
  return isAdmin(profile);
}

export function canUsePayroll(profile) {
  return isAdmin(profile);
}

export function canManageBoothRent(profile) {
  return isAdmin(profile) || isManager(profile);
}

export function canDeleteBoothRent(profile) {
  return isAdmin(profile);
}

export function canManageAppointments(profile) {
  return isAdmin(profile) || isManager(profile);
}
