export const OWNER_EMAIL = 'rickothebarber@gmail.com';
export const ALL_BUSINESSES_ACCESS = 'all-businesses';

export const PERMISSION_LEVELS = ['none', 'view', 'edit', 'admin'];

export const MODULE_IDS = [
  'staff_hub',
  'dashboard',
  'roster',
  'payroll',
  'performance',
  'appointments',
  'messages',
  'booth_rent',
  'operations',
  'access',
  'settings',
];

export const MODULE_LABELS = {
  access: 'Access',
  appointments: 'Appointments',
  booth_rent: 'Booth Rent',
  dashboard: 'Dashboard',
  messages: 'Messages',
  operations: 'Operations',
  payroll: 'Payroll',
  performance: 'Performance',
  roster: 'Roster',
  settings: 'Settings',
  staff_hub: 'Staff Hub',
};

export const PAGE_MODULE_MAP = {
  access: 'access',
  'action-center': 'operations',
  'ai-consultant': 'operations',
  'booth-rent': 'booth_rent',
  'customer-intelligence': 'performance',
  dashboard: 'dashboard',
  insights: 'appointments',
  integrations: 'settings',
  messages: 'messages',
  'my-role': 'profile',
  operations: 'operations',
  payroll: 'payroll',
  performance: 'performance',
  'staff-hub': 'staff_hub',
  staff: 'roster',
  system: 'settings',
};

const DEFAULT_PAYLOAD_META = {
  business_scope: 'selected',
  business_unit_ids: [],
  expectations: '',
  responsibilities: [],
  restrictions: ['No module access has been assigned yet.'],
  role_description: 'Custom access profile.',
  role_template: 'custom',
  role_title: 'Custom Role',
};

function titleCase(value) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function safeArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function uniqueArray(values) {
  return [...new Set(safeArray(values))];
}

function safeObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function shouldUseLegacyPermissionFallback(profile) {
  return Object.prototype.hasOwnProperty.call(profile || {}, 'permissions') && profile.permissions === null;
}

export function normalizePermissionLevel(value) {
  const normalized = String(value || 'none').trim().toLowerCase();
  return PERMISSION_LEVELS.includes(normalized) ? normalized : 'none';
}

export function createModulePermissions(level = 'none') {
  return MODULE_IDS.reduce(
    (permissions, moduleId) => ({
      ...permissions,
      [moduleId]: level,
    }),
    {},
  );
}

function hasAssignedModuleAccess(payload) {
  return MODULE_IDS.some(
    (moduleId) => normalizePermissionLevel(payload?.modules?.[moduleId]) !== 'none',
  );
}

function isStaffRole(profile = {}) {
  const safeProfile = profile || {};
  return String(safeProfile.role || '').trim().toLowerCase() === 'staff';
}

function createStaffPortalPermissions(profile = {}) {
  const businessUnitIds = profile.business_unit_id ? [profile.business_unit_id] : [];

  return buildPermissionsPayload({
    business_unit_ids: businessUnitIds,
    expectations: 'Use Staff Hub to review your own profile, earnings, performance, role expectations, and assigned business.',
    modules: {
      ...createModulePermissions(),
      staff_hub: 'view',
    },
    responsibilities: [
      'Review your Staff Hub updates',
      'Keep your staff profile details accurate',
      'Check your payroll and performance history',
      'Check your assigned business and role expectations',
      'Report schedule, profile, or access issues to management',
    ],
    restrictions: [
      'No payroll editing.',
      'No access management.',
      'No business settings changes.',
      'No deleting or changing other staff records.',
    ],
    role_description: 'Staff-only login for Staff Hub with personal payroll and performance history.',
    role_template: 'staff_portal',
    role_title: 'Staff Portal',
  });
}

export function normalizeModulePermissions(value) {
  const raw = safeObject(value);
  return MODULE_IDS.reduce(
    (permissions, moduleId) => ({
      ...permissions,
      [moduleId]: normalizePermissionLevel(raw[moduleId]),
    }),
    createModulePermissions(),
  );
}

export function normalizePermissionsPayload(value) {
  const raw = safeObject(value);
  const modules = normalizeModulePermissions(raw.modules || raw);
  const businessUnitIds = uniqueArray(raw.business_unit_ids || raw.businessUnitIds);
  const hasAllBusinesses = raw.business_scope === 'all' || businessUnitIds.includes(ALL_BUSINESSES_ACCESS);

  return {
    business_scope: hasAllBusinesses ? 'all' : DEFAULT_PAYLOAD_META.business_scope,
    business_unit_ids: hasAllBusinesses ? [ALL_BUSINESSES_ACCESS] : businessUnitIds,
    expectations: String(raw.expectations || DEFAULT_PAYLOAD_META.expectations),
    modules,
    responsibilities: safeArray(raw.responsibilities),
    restrictions: safeArray(raw.restrictions),
    role_description: String(raw.role_description || DEFAULT_PAYLOAD_META.role_description),
    role_template: String(raw.role_template || DEFAULT_PAYLOAD_META.role_template),
    role_title: String(raw.role_title || DEFAULT_PAYLOAD_META.role_title),
  };
}

export function buildPermissionsPayload(value = {}) {
  const base = normalizePermissionsPayload(value);
  const businessUnitIds = uniqueArray(value.business_unit_ids || base.business_unit_ids);
  const hasAllBusinesses = value.business_scope === 'all' || base.business_scope === 'all' || businessUnitIds.includes(ALL_BUSINESSES_ACCESS);

  return {
    ...base,
    business_scope: hasAllBusinesses ? 'all' : 'selected',
    business_unit_ids: hasAllBusinesses ? [ALL_BUSINESSES_ACCESS] : businessUnitIds,
    expectations: String(value.expectations ?? base.expectations ?? ''),
    modules: normalizeModulePermissions({ ...base.modules, ...(value.modules || {}) }),
    responsibilities: safeArray(value.responsibilities || base.responsibilities),
    restrictions: safeArray(value.restrictions || base.restrictions),
    role_description: String(value.role_description || base.role_description),
    role_template: String(value.role_template || base.role_template),
    role_title: String(value.role_title || base.role_title),
  };
}

export function createLegacyPermissionsFromRole(profile = {}) {
  const role = String(profile.role || '').trim().toLowerCase();

  if (isOwnerProfile(profile) || role === 'owner') {
    return buildPermissionsPayload({
      business_scope: 'all',
      business_unit_ids: [ALL_BUSINESSES_ACCESS],
      expectations: 'Owner access is protected and cannot be restricted inside RTB OS.',
      modules: createModulePermissions('admin'),
      responsibilities: [
        'Own final business decisions',
        'Manage user access',
        'Approve payroll and operational changes',
      ],
      restrictions: ['Owner access cannot be restricted inside RTB OS.'],
      role_description: 'Owner-level access across every RTB OS module.',
      role_template: 'owner',
      role_title: 'Owner',
    });
  }

  if (isStaffRole(profile)) return createStaffPortalPermissions(profile);

  const legacyPermissions = profile?.legacy_permissions || {};
  return buildPermissionsPayload({
    business_unit_ids: profile.business_unit_id ? [profile.business_unit_id] : [],
    modules: legacyPermissions,
    role_description: `${titleCase(role || 'custom')} access profile.`,
    role_template: role || 'custom',
    role_title: titleCase(profile.role_title || role || 'Custom Role'),
  });
}

export function getEffectivePermissionsPayload(profile = {}) {
  if (!profile) return normalizePermissionsPayload({});
  if (isOwnerProfile(profile)) return createLegacyPermissionsFromRole({ ...profile, role: 'owner' });

  const normalized = normalizePermissionsPayload(profile.permissions);
  if (hasAssignedModuleAccess(normalized)) return normalized;
  if (shouldUseLegacyPermissionFallback(profile)) return createLegacyPermissionsFromRole(profile);
  if (isStaffRole(profile)) return createStaffPortalPermissions(profile);
  return normalized;
}

export function getModulePermission(profile, moduleId) {
  return getEffectivePermissionsPayload(profile).modules[moduleId] || 'none';
}

export function hasModulePermission(profile, moduleId, minimum = 'view') {
  return PERMISSION_LEVELS.indexOf(getModulePermission(profile, moduleId)) >= PERMISSION_LEVELS.indexOf(minimum);
}

export function hasAnyModulePermission(profile, minimum = 'view') {
  return MODULE_IDS.some((moduleId) => hasModulePermission(profile, moduleId, minimum));
}

export function isOwnerProfile(profile = {}) {
  return String(profile?.email || '').trim().toLowerCase() === OWNER_EMAIL || String(profile?.role || '').trim().toLowerCase() === 'owner';
}

export function getProfileRoleTitle(profile = {}) {
  const payload = getEffectivePermissionsPayload(profile);
  return payload.role_title || titleCase(profile?.role_title || profile?.role || 'Custom Role');
}

export function getProfileResponsibilities(profile = {}) {
  return getEffectivePermissionsPayload(profile).responsibilities;
}

export function getProfileRestrictions(profile = {}) {
  return getEffectivePermissionsPayload(profile).restrictions;
}

export function getProfileExpectations(profile = {}) {
  return getEffectivePermissionsPayload(profile).expectations;
}

export function hasAllBusinessAccess(profile = {}) {
  const payload = getEffectivePermissionsPayload(profile);
  return payload.business_scope === 'all' || payload.business_unit_ids.includes(ALL_BUSINESSES_ACCESS);
}
