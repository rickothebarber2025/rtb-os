import {
  buildPermissionsPayload,
  createModulePermissions,
} from './permissions.js';

function permissions(overrides) {
  return {
    ...createModulePermissions(),
    ...overrides,
  };
}

const allAdmin = createModulePermissions('admin');

export const ROLE_TEMPLATES = [
  {
    description: 'No preset access. Start from none and customize intentionally.',
    id: 'custom',
    permissions: createModulePermissions(),
    responsibilities: [],
    restrictions: ['No module access until permissions are assigned.'],
    roleValue: 'staff',
    title: 'Custom Role',
  },
  {
    description: 'Owner-level access across every business and module.',
    id: 'owner',
    permissions: allAdmin,
    responsibilities: [
      'Own final business decisions',
      'Manage user access and business settings',
      'Approve payroll, reports, and operational changes',
    ],
    restrictions: ['Owner access cannot be restricted inside RTB OS.'],
    roleValue: 'admin',
    title: 'Owner',
  },
  {
    description: 'Full operating access for trusted administrators.',
    id: 'full_admin',
    permissions: allAdmin,
    responsibilities: [
      'Manage all modules',
      'Invite and update users',
      'Fix data mistakes and keep business records clean',
    ],
    restrictions: ['Should only be assigned to trusted leadership.'],
    roleValue: 'admin',
    title: 'Full Admin',
  },
  {
    description: 'Runs RTB Beauty Lounge daily operations without user-access control.',
    id: 'beauty_manager',
    permissions: permissions({
      appointments: 'admin',
      booth_rent: 'edit',
      dashboard: 'view',
      operations: 'edit',
      payroll: 'view',
      performance: 'edit',
      roster: 'edit',
      settings: 'view',
    }),
    responsibilities: [
      'Review Square appointment syncs',
      'Keep beauty roster profiles current',
      'Watch performance and service trends',
      'Report payroll issues to Ricko before payroll is finalized',
    ],
    restrictions: ['Cannot manage user access.', 'Cannot finalize payroll unless customized.'],
    roleValue: 'manager',
    title: 'Beauty Manager',
  },
  {
    description: 'Runs RTB Lounge barbershop operations with Booksy and Square data.',
    id: 'barbershop_manager',
    permissions: permissions({
      appointments: 'edit',
      booth_rent: 'edit',
      dashboard: 'view',
      operations: 'edit',
      payroll: 'view',
      performance: 'edit',
      roster: 'edit',
      settings: 'view',
    }),
    responsibilities: [
      'Review Booksy imports',
      'Keep barber profiles accurate',
      'Track booth rent issues',
      'Report payroll and sales data problems to Ricko',
    ],
    restrictions: ['Cannot manage user access.', 'Cannot finalize payroll unless customized.'],
    roleValue: 'manager',
    title: 'Barbershop Manager',
  },
  {
    description: 'Helps prepare payroll without access to user management.',
    id: 'payroll_assistant',
    permissions: permissions({
      dashboard: 'view',
      payroll: 'edit',
      performance: 'view',
      roster: 'view',
    }),
    responsibilities: [
      'Review payroll drafts',
      'Check missing staff payout details',
      'Flag commission or deduction issues',
      'Keep payroll history organized',
    ],
    restrictions: ['Cannot manage users.', 'Cannot edit staff access.', 'Cannot change settings.'],
    roleValue: 'staff',
    title: 'Payroll Assistant',
  },
  {
    description: 'Maintains SOPs, tasks, action items, and operating records.',
    id: 'operations_assistant',
    permissions: permissions({
      dashboard: 'view',
      operations: 'edit',
      performance: 'view',
      roster: 'view',
      settings: 'view',
    }),
    responsibilities: [
      'Maintain operations checklists',
      'Track business action items',
      'Update SOP notes and issue logs',
      'Report blocked tasks to management',
    ],
    restrictions: ['No payroll edits.', 'No user access changes.', 'No booth rent changes unless customized.'],
    roleValue: 'staff',
    title: 'Operations Assistant',
  },
  {
    description: 'Handles appointment imports, no-shows, and schedule issues.',
    id: 'appointment_coordinator',
    permissions: permissions({
      appointments: 'edit',
      dashboard: 'view',
      operations: 'view',
      roster: 'view',
    }),
    responsibilities: [
      'Check appointment imports',
      'Watch no-shows',
      'Help update appointment issues',
      'Report problems to Ricko',
    ],
    restrictions: ['No payroll access.', 'No access management.', 'No settings changes.'],
    roleValue: 'staff',
    title: 'Appointment Coordinator',
  },
  {
    description: 'Can see operational context for content planning without financial controls.',
    id: 'content_marketing',
    permissions: permissions({
      appointments: 'view',
      dashboard: 'view',
      operations: 'view',
      performance: 'view',
      roster: 'view',
    }),
    responsibilities: [
      'Review service and staff highlights',
      'Track content ideas from appointment trends',
      'Flag review or marketing opportunities',
    ],
    restrictions: ['No payroll access.', 'No user access changes.', 'No operational edits unless customized.'],
    roleValue: 'staff',
    title: 'Content/Marketing',
  },
  {
    description: 'Read-only access for reviewing reports without changing data.',
    id: 'view_only',
    permissions: permissions({
      appointments: 'view',
      booth_rent: 'view',
      dashboard: 'view',
      operations: 'view',
      payroll: 'view',
      performance: 'view',
      roster: 'view',
      settings: 'view',
    }),
    responsibilities: [
      'Review assigned reports',
      'Monitor business status',
      'Tell management when something looks wrong',
    ],
    restrictions: ['Cannot add, update, delete, finalize, invite, or change settings.'],
    roleValue: 'staff',
    title: 'View Only',
  },
];

export function getRoleTemplate(templateId) {
  return ROLE_TEMPLATES.find((template) => template.id === templateId) || ROLE_TEMPLATES[0];
}

export function buildPermissionsFromTemplate(templateId, overrides = {}) {
  const template = getRoleTemplate(templateId);

  return buildPermissionsPayload({
    modules: template.permissions,
    responsibilities: template.responsibilities,
    restrictions: template.restrictions,
    role_description: template.description,
    role_template: template.id,
    role_title: template.title,
    ...overrides,
  });
}

export function getTemplateRoleValue(templateId) {
  return getRoleTemplate(templateId).roleValue;
}
