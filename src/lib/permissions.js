export const OWNER_EMAIL = 'rickothebarber@gmail.com';
export const ALL_BUSINESSES_ACCESS = 'all-businesses';

export const PERMISSION_LEVELS = ['none', 'view', 'edit', 'admin'];

export const MODULE_IDS = [
  'dashboard',
  'roster',
  'payroll',
  'performance',
  'appointments',
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
  operations: 'Operations',
  payroll: 'Payroll',
  performance: 'Performance',
  roster: 'Roster',
  settings: 'Settings',
};

export const PAGE_MODULE_MAP = {
  access: 'access',
  'action-center': 'operations',
  'ai-consultant': 'operations',
  'booth-rent': 'booth_rent',
  'customer-intelligence': 'performance',
  dashboard: 'dashboard',
  insights: 'appointments',
  'my-role': 'profile',
  operations: 'operations',
  payroll: 'payroll',
  performance: 'performance',
  'staff-hub': 'dashboard',
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
  const hasAllBusinesses =
    raw.business_scope === 'all' || businessUnitIds.includes(ALL_BUSINESSES_ACCESS);

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
  const hasAllBusinesses =
    value.business_scope === 'all' || base.business_scope === 'all' || businessUnitIds.includes(ALL_BUSINESSES_ACCESS);

  return {
    ...base,
    business_scope: hasAllBusinesses ? 'all' : 'selected',
    business_unit_ids: hasAllBusinesses ? [ALL_BUSINESSES_ACCESS] : businessUnitIds,
    expectations: String(value.expectations ?? base.expectations ?? ''),
    modules: normalizeModulePermissions({
      ...base.modules,
      ...(value.modules || {}),
    }),
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

  if (role === 'admin') {
    return buildPermissionsPayload({
      business_unit_ids: profile.business_unit_id ? [profile.business_unit_id] : [],
      expectations: 'Legacy admin fallback. Save an explicit role template to replace this fallback.',
      modules: createModulePermissions('admin'),
      responsibilities: ['Manage assigned business operations until explicit permissions are saved.'],
      restrictions: ['Legacy fallback should be replaced with a saved role template.'],
      role_description: 'Temporary fallback for an existing admin profile without saved permissions.',
      role_template: 'legacy_admin',
      role_title: 'Legacy Admin',
    });
  }

  if (role === 'manager') {
    return buildPermissionsPayload({
      business_unit_ids: profile.business_unit_id ? [profile.business_unit_id] : [],
      expectations: 'Legacy manager fallback. Save an explicit role template to replace this fallback.',
      modules: {
        ...createModulePermissions(),
        appointments: 'edit',
        booth_rent: 'edit',
        dashboard: 'view',
        operations: 'edit',
        payroll: 'view',
        performance: 'edit',
        roster: 'edit',
        settings: 'view',
      },
      responsibilities: ['Run assigned business operations until explicit permissions are saved.'],
      restrictions: ['Cannot manage user access unless permissions are customized.'],
      role_description: 'Temporary fallback for an existing manager profile without saved permissions.',
      role_template: 'legacy_manager',
      role_title: 'Legacy Manager',
    });
  }

  if (role === 'staff') {
    return buildPermissionsPayload({
      business_unit_ids: profile.business_unit_id ? [profile.business_unit_id] : [],
      expectations: 'Legacy staff fallback. Ask an access admin to save an explicit role template.',
      modules: {
        ...createModulePermissions(),
        dashboard: 'view',
        operations: 'view',
      },
      responsibilities: ['Review assigned information and report issues to management.'],
      restrictions: ['Cannot edit business records until permissions are customized.'],
      role_description: 'Temporary fallback for an existing staff profile without saved permissions.',
      role_template: 'legacy_staff',
      role_title: 'Legacy Staff',
    });
  }

  return normalizePermissionsPayload(null);
}

export function mergeProfilePermissionFields(profile = {}) {
  const raw = safeObject(profile.permissions);
  const payload = normalizePermissionsPayload({
    ...raw,
    expectations: profile.expectations ?? raw.expectations,
    responsibilities: profile.responsibilities ?? raw.responsibilities,
    restrictions: profile.restrictions ?? raw.restrictions,
    role_description: profile.role_description || raw.role_description,
    role_title: profile.role_title || raw.role_title,
  });

  return {
    ...profile,
    expectations: payload.expectations,
    permissions: payload,
    responsibilities: payload.responsibilities,
    restrictions: payload.restrictions,
    role_description: payload.role_description,
    role_title: payload.role_title,
  };
}

export function isOwnerEmail(email) {
  return String(email || '').trim().toLowerCase() === OWNER_EMAIL;
}

export function isOwnerProfile(profile) {
  return Boolean(
    profile?.is_owner ||
      profile?.owner ||
      profile?.owner_override ||
      profile?.role === 'owner' ||
      isOwnerEmail(profile?.email),
  );
}

export function hasAllBusinessAccess(profile) {
  if (isOwnerProfile(profile)) return true;
  const payload = normalizePermissionsPayload(profile?.permissions);
  return (
    payload.business_scope === 'all' ||
    payload.business_unit_ids.includes(ALL_BUSINESSES_ACCESS)
  );
}

export function getProfileBusinessUnitIds(profile) {
  if (isOwnerProfile(profile)) return [ALL_BUSINESSES_ACCESS];

  const payload = normalizePermissionsPayload(profile?.permissions);
  if (payload.business_scope === 'all') return [ALL_BUSINESSES_ACCESS];

  const explicitIds = payload.business_unit_ids.filter((id) => id !== ALL_BUSINESSES_ACCESS);
  if (explicitIds.length) return uniqueArray(explicitIds);

  return profile?.business_unit_id ? [String(profile.business_unit_id)] : [];
}

export function profileCanAccessBusiness(profile, businessUnitId) {
  if (!businessUnitId) return false;
  if (hasAllBusinessAccess(profile)) return true;
  return getProfileBusinessUnitIds(profile).includes(String(businessUnitId));
}

export function getEffectivePermissionsPayload(profile) {
  if (isOwnerProfile(profile)) {
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

  if (profile && shouldUseLegacyPermissionFallback(profile)) {
    return createLegacyPermissionsFromRole(profile);
  }

  const profilePayload = mergeProfilePermissionFields(profile || {});
  const payload = normalizePermissionsPayload(profilePayload.permissions);
  if (payload.role_title !== DEFAULT_PAYLOAD_META.role_title) return payload;

  const role = String(profile?.role || '').trim();
  return {
    ...payload,
    role_title: role ? titleCase(role) : payload.role_title,
  };
}

export function getProfileRoleTitle(profile) {
  return getEffectivePermissionsPayload(profile).role_title || 'Custom Role';
}

export function getProfileResponsibilities(profile) {
  return getEffectivePermissionsPayload(profile).responsibilities;
}

export function getProfileRestrictions(profile) {
  return getEffectivePermissionsPayload(profile).restrictions;
}

export function getProfileExpectations(profile) {
  return getEffectivePermissionsPayload(profile).expectations;
}

export function getModulePermission(profile, moduleId) {
  return getEffectivePermissionsPayload(profile).modules[moduleId] || 'none';
}

export function isPermissionAtLeast(current, required) {
  return PERMISSION_LEVELS.indexOf(current) >= PERMISSION_LEVELS.indexOf(required);
}

export function hasModulePermission(profile, moduleId, minimum = 'view') {
  if (!profile) return false;
  if (!isOwnerProfile(profile) && !profile.active) return false;
  return isPermissionAtLeast(getModulePermission(profile, moduleId), minimum);
}

export function hasAnyModulePermission(profile, minimum = 'view') {
  if (!profile) return false;
  if (!isOwnerProfile(profile) && !profile.active) return false;
  return MODULE_IDS.some((moduleId) => hasModulePermission(profile, moduleId, minimum));
}
