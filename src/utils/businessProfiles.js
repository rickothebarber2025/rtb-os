import { isAdmin } from './access.js';
import {
  getProfileBusinessUnitIds,
  hasAllBusinessAccess,
  isOwnerProfile,
} from '../lib/permissions.js';

export const ALL_BUSINESSES_ID = 'all-businesses';
export const BUSINESS_PROFILES_KEY = 'business_profiles';

export const BUSINESS_STAFF_ROLES = {
  'RTB Lounge': ['Barber', 'Hairstylist'],
  'RTB Beauty Lounge': ['Nail Tech', 'Lash Tech'],
};

export const DEFAULT_BUSINESS_PROFILES = {
  'RTB Lounge': {
    business_name: 'RTB Lounge',
    business_type: 'Barbershop',
    booking_platform: 'Booksy',
    default_commission_rules: {
      auto_adjust_floor: 55,
      deduction_per_payroll_entry: 5,
      fixed_low_sales_adjustment: 5,
      standard_rate: 60,
      under_minimum_net_sales: 500,
    },
    import_source: 'Booksy report import + Square POS sales import',
    instagram_format: 'firstname.rtb_lounge',
    instagram_formats: ['firstname.rtb_lounge', 'firstnamelastname'],
    payroll_rules: {
      appointment_source: 'Booksy',
      pos_source: 'Square POS',
      source_note: 'Use Booksy appointment imports with Square POS revenue tracking.',
    },
    pos_platform: 'Square',
    staff_roles: BUSINESS_STAFF_ROLES['RTB Lounge'],
  },
  'RTB Beauty Lounge': {
    business_name: 'RTB Beauty Lounge',
    business_type: 'Beauty Services',
    booking_platform: 'Square Appointments',
    default_commission_rules: {
      auto_adjust_floor: 55,
      deduction_per_payroll_entry: 5,
      fixed_low_sales_adjustment: 5,
      standard_rate: 60,
      under_minimum_net_sales: 500,
    },
    import_source: 'Square Appointments/POS import',
    instagram_format: 'firstname.rtb_lounge',
    instagram_formats: ['firstname.rtb_lounge', 'firstnamelastname'],
    payroll_rules: {
      appointment_source: 'Square Appointments',
      pos_source: 'Square POS',
      source_note: 'Use Square Appointments and Square POS data for beauty services payroll.',
    },
    pos_platform: 'Square',
    staff_roles: BUSINESS_STAFF_ROLES['RTB Beauty Lounge'],
  },
};

export const ALL_BUSINESSES_UNIT = {
  booking_platform: 'Booksy + Square Appointments',
  business_type: 'Combined operations',
  id: ALL_BUSINESSES_ID,
  import_source: 'Combined reporting only',
  instagram_format: 'Business-specific rules',
  isAllBusinesses: true,
  name: 'All Businesses',
  pos_platform: 'Square',
};

function getProfileOverride(overrides, businessName) {
  if (!overrides || typeof overrides !== 'object') return {};
  return overrides[businessName] || overrides[businessName?.toLowerCase?.()] || {};
}

export function getStaffRolesForBusinessName(businessName) {
  return BUSINESS_STAFF_ROLES[businessName] || ['Staff'];
}

export function getCombinedStaffRoles() {
  return [...new Set(Object.values(BUSINESS_STAFF_ROLES).flat())];
}

export function normalizeBusinessProfiles(value) {
  return Object.fromEntries(
    Object.entries(DEFAULT_BUSINESS_PROFILES).map(([businessName, defaults]) => {
      const profile = {
        ...defaults,
        ...getProfileOverride(value, businessName),
        business_name: businessName,
      };

      return [
        businessName,
        {
          ...profile,
          staff_roles: getStaffRolesForBusinessName(businessName),
        },
      ];
    }),
  );
}

export function getBusinessProfile(businessUnit, overrides = null) {
  if (isAllBusinessesUnit(businessUnit)) return ALL_BUSINESSES_UNIT;
  const profiles = normalizeBusinessProfiles(overrides);
  return (
    profiles[businessUnit?.name] || {
      business_name: businessUnit?.name || 'RTB',
      business_type: 'Operations',
      booking_platform: 'Manual',
      default_commission_rules: DEFAULT_BUSINESS_PROFILES['RTB Lounge'].default_commission_rules,
      import_source: 'Manual import',
      instagram_format: 'firstname.rtb_lounge',
      instagram_formats: ['firstname.rtb_lounge', 'firstnamelastname'],
      payroll_rules: {
        appointment_source: 'Manual',
        pos_source: 'Square POS',
        source_note: 'Track sales and payroll under the selected business.',
      },
      pos_platform: 'Square',
      staff_roles: ['Staff', 'Manager'],
    }
  );
}

export function hydrateBusinessUnits(businessUnits, profileOverrides = null) {
  return businessUnits.map((unit) => ({
    ...unit,
    profile: getBusinessProfile(unit, profileOverrides),
  }));
}

export function getAccessibleBusinessUnits(businessUnits, profile) {
  if (isOwnerProfile(profile) || hasAllBusinessAccess(profile)) return businessUnits;

  const allowedIds = new Set(getProfileBusinessUnitIds(profile));
  return businessUnits.filter((unit) => allowedIds.has(unit.id));
}

export function canUseAllBusinesses(profile, businessUnits = []) {
  if (!isAdmin(profile)) return false;
  if (isOwnerProfile(profile) || hasAllBusinessAccess(profile)) return true;

  const accessibleCount = getAccessibleBusinessUnits(businessUnits, profile).length;
  return accessibleCount > 1;
}

export function getBusinessSelectionOptions(businessUnits, profile) {
  const accessibleUnits = getAccessibleBusinessUnits(businessUnits, profile);
  if (!canUseAllBusinesses(profile, businessUnits)) return accessibleUnits;
  return [ALL_BUSINESSES_UNIT, ...accessibleUnits];
}

export function isAllBusinessesId(value) {
  return value === ALL_BUSINESSES_ID;
}

export function isAllBusinessesUnit(businessUnit) {
  return Boolean(businessUnit?.isAllBusinesses || isAllBusinessesId(businessUnit?.id));
}

export function getAppointmentSettingKey(businessUnit) {
  if (businessUnit?.name === 'RTB Beauty Lounge') return 'rtb_beauty_square_appointments';
  return 'rtb_master_dashboard';
}

export function usesSquareAppointments(businessUnit) {
  return getBusinessProfile(businessUnit).booking_platform === 'Square Appointments';
}

function nameParts(fullName) {
  const parts = String(fullName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return {
    first: parts[0] || 'staff',
    last: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

export function suggestInstagramHandle(fullName, format = 'firstname.rtb_lounge') {
  const { first, last } = nameParts(fullName);
  if (format === 'firstnamelastname') return `${first}${last}`;
  return `${first}.rtb_lounge`;
}
