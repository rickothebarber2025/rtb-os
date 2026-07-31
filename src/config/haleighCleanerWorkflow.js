export const HALEIGH_CLEANER_ROLE = 'operations_cleaning';
export const HALEIGH_CLEANER_TIMEZONE = 'America/Toronto';

export const HALEIGH_CLEANER_PERMISSIONS = Object.freeze({
  allow: [
    'staff_hub',
    'my_schedule',
    'my_tasks',
    'notifications',
    'clock_in',
    'clock_out',
    'view_own_attendance',
    'opening_checklist',
    'daily_cleaning_tasks',
    'closing_inspection',
    'maintenance_requests',
    'report_issues',
    'upload_photos',
    'supply_inventory_view',
    'supply_requests_create',
    'cleaning_history_view',
    'assigned_tasks_view',
    'own_performance_view',
  ],
  deny: [
    'payroll',
    'earnings',
    'commission',
    'financial_reports',
    'bookings',
    'client_management',
    'staff_management',
    'user_management',
    'permission_management',
    'business_settings',
    'marketing',
    'full_analytics',
    'operations_configuration',
    'checklist_template_editing',
    'inventory_administration',
  ],
});

export const HALEIGH_SHIFT = Object.freeze({
  start: '08:00',
  end: '10:00',
  lateAlert: '08:10',
  incompleteAlert: '09:45',
  readyDeadline: '10:00',
  timezone: HALEIGH_CLEANER_TIMEZONE,
});

export const HALEIGH_OPENING_CHECKLIST = Object.freeze([
  {
    section: 'Reception and waiting area',
    tasks: [
      'Vacuum reception floor',
      'Mop reception floor',
      'Wipe reception desk',
      'Organize front counter',
      'Clean front door glass inside and outside',
      'Clean waiting-area chairs',
      'Organize magazines and products',
      'Restock refreshments',
      'Confirm waiting area is spotless',
    ],
  },
  {
    section: 'Washroom',
    tasks: [
      'Clean toilet',
      'Clean sink',
      'Clean mirror',
      'Mop floor',
      'Empty garbage',
      'Refill soap',
      'Refill toilet paper',
      'Refill paper towels',
    ],
  },
  {
    section: 'Barbershop common areas',
    tasks: [
      'Vacuum common areas',
      'Mop common areas',
      'Wipe shared countertops',
      'Empty shared garbage bins',
      'Clean shared mirrors',
      'Organize waiting area',
      'Check shared supplies',
    ],
  },
  {
    section: 'RTB Beauty Lounge common areas',
    tasks: [
      'Vacuum common areas',
      'Mop common areas',
      'Wipe shared counters',
      'Empty shared garbage',
      'Clean shared mirrors',
      'Organize Beauty Lounge reception area',
      'Check shared supplies',
    ],
  },
  {
    section: 'Stock and maintenance',
    tasks: [
      'Restock cleaning products',
      'Restock paper products',
      'Report low inventory',
      'Report damaged equipment',
      'Report maintenance issues',
    ],
  },
  {
    section: 'Final walkthrough',
    tasks: [
      'Walk through the barbershop',
      'Walk through RTB Beauty Lounge',
      'Upload final walkthrough photo',
      'Confirm shop is client-ready before 10:00 AM',
    ],
    requiresPhoto: true,
  },
]);

export const STAFF_CLOSING_CHECKLIST = Object.freeze([
  'Clean and sanitize station',
  'Sanitize chair',
  'Sweep hair or debris',
  'Take own garbage',
  'Put tools away',
  'Store products properly',
  'Unplug equipment where required',
  'Leave station ready for the next day',
]);

export const STATION_INSPECTION_STATUSES = Object.freeze([
  'passed',
  'needs_attention',
  'failed',
  'not_inspected',
]);

export function validateStationInspection(inspection) {
  if (!STATION_INSPECTION_STATUSES.includes(inspection?.status)) {
    throw new Error('Invalid station inspection status.');
  }

  if (inspection.status === 'failed') {
    if (!inspection.responsibleStaffId) throw new Error('Failed inspections require a responsible staff member.');
    if (!inspection.photoUrl) throw new Error('Failed inspections require photo evidence.');
    if (!inspection.note?.trim()) throw new Error('Failed inspections require a written note.');
  }

  return true;
}

export function canAccessCleanerFeature(permission) {
  if (HALEIGH_CLEANER_PERMISSIONS.deny.includes(permission)) return false;
  return HALEIGH_CLEANER_PERMISSIONS.allow.includes(permission);
}
