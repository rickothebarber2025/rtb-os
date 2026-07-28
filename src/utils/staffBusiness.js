import {
  getBusinessProfile,
  suggestInstagramHandle,
} from './businessProfiles.js';

export const STAFF_BUSINESS_METADATA_KEY = 'staff_business_metadata';

export function normalizeStaffBusinessMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueIds(values) {
  return [...new Set(values.filter(Boolean))];
}

export function getStaffBusinessMetadata(metadata, staffId) {
  const source = normalizeStaffBusinessMetadata(metadata);
  const record = source[staffId] && typeof source[staffId] === 'object' ? source[staffId] : {};

  return {
    assigned_business_ids: Array.isArray(record.assigned_business_ids)
      ? uniqueIds(record.assigned_business_ids)
      : [],
    booking_platform_profile: record.booking_platform_profile || '',
    commission_type: record.commission_type || '',
    instagram_handle: record.instagram_handle || '',
    instagram_manual_override: Boolean(record.instagram_manual_override),
    instagram_rule: record.instagram_rule || 'firstname.rtb_lounge',
    pos_profile: record.pos_profile || '',
    updated_at: record.updated_at || null,
  };
}

export function staffBusinessIds(member) {
  return uniqueIds([
    member?.business_unit_id,
    ...(
      Array.isArray(member?.assigned_business_ids)
        ? member.assigned_business_ids
        : []
    ),
  ]);
}

export function staffBelongsToBusiness(member, businessUnitId) {
  if (!businessUnitId) return true;
  return staffBusinessIds(member).includes(businessUnitId);
}

export function businessNamesForStaff(member, businessUnits) {
  const ids = staffBusinessIds(member);
  return ids
    .map((id) => businessUnits.find((unit) => unit.id === id)?.name)
    .filter(Boolean);
}

export function enrichStaffWithBusinessMetadata(staff, metadata, businessUnits) {
  return staff.map((member) => {
    const record = getStaffBusinessMetadata(metadata, member.id);
    const assignedIds = uniqueIds([member.business_unit_id, ...record.assigned_business_ids]);
    const primaryBusiness = businessUnits.find((unit) => unit.id === member.business_unit_id);
    const profile = getBusinessProfile(primaryBusiness);
    const instagramHandle =
      record.instagram_handle ||
      suggestInstagramHandle(member.full_name, record.instagram_rule || profile.instagram_format);

    return {
      ...member,
      assigned_business_ids: assignedIds,
      assigned_business_names: assignedIds
        .map((id) => businessUnits.find((unit) => unit.id === id)?.name)
        .filter(Boolean),
      booking_platform_profile: record.booking_platform_profile || member.full_name || '',
      commission_type:
        record.commission_type ||
        (member.fixed_rate ? 'Fixed rate' : 'Commission'),
      instagram_handle: instagramHandle,
      instagram_manual_override: record.instagram_manual_override,
      instagram_rule: record.instagram_rule || profile.instagram_format,
      pos_profile: record.pos_profile || member.full_name || '',
      primary_business_name: primaryBusiness?.name || '',
    };
  });
}

export function mergeStaffBusinessMetadata(existing, staffId, patch) {
  const current = normalizeStaffBusinessMetadata(existing);
  const previous = getStaffBusinessMetadata(current, staffId);

  return {
    ...current,
    [staffId]: {
      ...previous,
      ...patch,
      assigned_business_ids: uniqueIds(patch.assigned_business_ids || previous.assigned_business_ids),
      updated_at: new Date().toISOString(),
    },
  };
}
