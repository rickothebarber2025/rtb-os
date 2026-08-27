import {
  buildPermissionsPayload,
  createModulePermissions,
} from './permissions.js';

function permissions(overrides) {
  return {
    ...createModulePermissions(),
    staff_hub: 'view',
    ...overrides,
  };
}

const allAdmin = createModulePermissions('admin');

export const ROLE_TEMPLATES = [
  {
    description: 'No preset access. Start from none and customize intentionally.',
    expectations: 'Choose a template or customize permissions before this user starts working in RTB OS.',
    id: 'custom',
    permissions: createModulePermissions(),
    responsibilities: [],
    restrictions: ['No module access until permissions are assigned.'],
    roleValue: 'staff',
    title: 'Custom Role',
  },
  {
    description: 'New-hire onboarding access with no scheduling, payment, admin, or operational control until manager approval.',
    expectations: 'Complete every onboarding stage, policy signature, knowledge check, and practical certification before full shop access is granted.',
    id: 'onboarding_restricted',
    permissions: permissions({ staff_hub: 'view' }),
    responsibilities: [
      'Complete personal setup and required documents',
      'Review RTB standards and operating procedures',
      'Pass each knowledge check',
      'Complete practical shop certification with a manager',
      'Sign every required policy before approval',
    ],
    restrictions: [
      'Onboarding only.',
      'No scheduling access.',
      'No payment, payroll, tips, or commission controls.',
      'No administrative access.',
      'No client, booking, refund, or checkout access until manager approval.',
    ],
    roleValue: 'staff',
    title: 'Onboarding — Restricted',
  },
  {
    description: 'Staff-only login for Staff Hub with personal payroll and performance history.',
    expectations: 'Use Staff Hub to review role details, assigned business information, staff profile updates, earnings, and performance.',
    id: 'staff_portal',
    permissions: permissions({ staff_hub: 'view' }),
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
    roleValue: 'staff',
    title: 'Staff Portal',
  },
  {
    description: 'Owner-level access across every business and module.',
    expectations: 'Own final decisions and keep access, payroll, and operating standards accurate.',
    id: 'owner',
    permissions: allAdmin,
    responsibilities: ['Own final business decisions', 'Manage user access and business settings', 'Approve payroll, reports, and operational changes'],
    restrictions: ['Owner access cannot be restricted inside RTB OS.'],
    roleValue: 'admin',
    title: 'Owner',
  },
  {
    description: 'Full operating access for trusted administrators.',
    expectations: 'Keep the platform clean, correct data mistakes, and escalate major changes to Ricko.',
    id: 'full_admin',
    permissions: allAdmin,
    responsibilities: ['Manage all modules', 'Invite and update users', 'Fix data mistakes and keep business records clean'],
    restrictions: ['Should only be assigned to trusted leadership.'],
    roleValue: 'admin',
    title: 'Full Admin',
  },
  {
    description: 'Runs RTB Beauty Lounge daily operations without user-access control.',
    expectations: 'Keep RTB Beauty Lounge appointment, roster, and performance records current each week.',
    id: 'beauty_manager',
    permissions: permissions({ appointments: 'admin', booth_rent: 'edit', dashboard: 'view', operations: 'edit', payroll: 'view', performance: 'edit', roster: 'edit', settings: 'view' }),
    responsibilities: ['Review Square appointment syncs', 'Keep beauty roster profiles current', 'Watch performance and service trends', 'Report payroll issues to Ricko before payroll is finalized'],
    restrictions: ['Cannot manage user access.', 'Cannot finalize payroll unless customized.'],
    roleValue: 'manager',
    title: 'Beauty Manager',
  },
  {
    description: 'Runs RTB Lounge barbershop operations with Booksy and Square data.',
    expectations: 'Keep RTB Lounge Booksy imports, staff records, and booth rent follow-up current.',
    id: 'barbershop_manager',
    permissions: permissions({ appointments: 'edit', booth_rent: 'edit', dashboard: 'view', operations: 'edit', payroll: 'view', performance: 'edit', roster: 'edit', settings: 'view' }),
    responsibilities: ['Review Booksy imports', 'Keep barber profiles accurate', 'Track booth rent issues', 'Report payroll and sales data problems to Ricko'],
    restrictions: ['Cannot manage user access.', 'Cannot finalize payroll unless customized.'],
    roleValue: 'manager',
    title: 'Barbershop Manager',
  },
  {
    description: 'Helps prepare payroll without access to user management.',
    expectations: 'Prepare payroll carefully and flag anything that needs owner approval before finalization.',
    id: 'payroll_assistant',
    permissions: permissions({ dashboard: 'view', payroll: 'edit', performance: 'view', roster: 'view' }),
    responsibilities: ['Review payroll drafts', 'Check missing staff payout details', 'Flag commission or deduction issues', 'Keep payroll history organized'],
    restrictions: ['Cannot manage users.', 'Cannot edit staff access.', 'Cannot change settings.'],
    roleValue: 'staff',
    title: 'Payroll Assistant',
  },
  {
    description: 'Maintains SOPs, tasks, action items, and operating records.',
    expectations: 'Keep tasks, SOPs, and operating notes organized so management can act quickly.',
    id: 'operations_assistant',
    permissions: permissions({ dashboard: 'view', operations: 'edit', performance: 'view', roster: 'view', settings: 'view' }),
    responsibilities: ['Maintain operations checklists', 'Track business action items', 'Update SOP notes and issue logs', 'Report blocked tasks to management'],
    restrictions: ['No payroll edits.', 'No user access changes.', 'No booth rent changes unless customized.'],
    roleValue: 'staff',
    title: 'Operations Assistant',
  },
  {
    description: 'Contractor cleaning workspace with access only to the role-specific Staff Hub workflow.',
    expectations: 'Work the assigned cleaning shift, complete every required whole-shop cleaning and restocking category, save progress as you go, upload the final walkthrough photo, and report inventory or maintenance issues before finishing.',
    id: 'operations_cleaning',
    permissions: permissions({ staff_hub: 'view' }),
    responsibilities: [
      'Clock in and out for the assigned cleaning shift',
      'Complete whole-shop reception, washroom, common-area and Beauty Lounge cleaning categories',
      'Restock shared cleaning, washroom and paper supplies',
      'Complete inventory checks and report low stock',
      'Upload a final walkthrough photo before finishing',
      'Report damaged equipment and maintenance issues',
    ],
    restrictions: [
      'No payroll or earnings access.',
      'No appointment or client access.',
      'No staff, user, or permission management.',
      'No business settings changes.',
      'No financial, booth-rent, or performance reports.',
      'No standalone Operations module or checklist-template configuration.',
      'No service-provider station or reusable-tool reprocessing responsibility.',
    ],
    roleValue: 'contractor',
    title: 'Operations Cleaning',
  },
  {
    description: 'Handles appointment imports, no-shows, and schedule issues.',
    expectations: 'Check appointment data regularly and report import, no-show, or schedule issues quickly.',
    id: 'appointment_coordinator',
    permissions: permissions({ appointments: 'edit', dashboard: 'view', operations: 'view', roster: 'view' }),
    responsibilities: ['Check appointment imports', 'Watch no-shows', 'Help update appointment issues', 'Report problems to Ricko'],
    restrictions: ['No payroll access.', 'No access management.', 'No settings changes.'],
    roleValue: 'staff',
    title: 'Appointment Coordinator',
  },
  {
    description: 'Can see operational context for content planning without financial controls.',
    expectations: 'Use approved business context for content planning without changing operational records.',
    id: 'content_marketing',
    permissions: permissions({ appointments: 'view', dashboard: 'view', operations: 'view', performance: 'view', roster: 'view' }),
    responsibilities: ['Review service and staff highlights', 'Track content ideas from appointment trends', 'Flag review or marketing opportunities'],
    restrictions: ['No payroll access.', 'No user access changes.', 'No operational edits unless customized.'],
    roleValue: 'staff',
    title: 'Content/Marketing',
  },
  {
    description: 'Read-only access for reviewing reports without changing data.',
    expectations: 'Review assigned information and tell management when something looks wrong.',
    id: 'view_only',
    permissions: permissions({ appointments: 'view', booth_rent: 'view', dashboard: 'view', operations: 'view', payroll: 'view', performance: 'view', roster: 'view', settings: 'view' }),
    responsibilities: ['Review assigned reports', 'Monitor business status', 'Tell management when something looks wrong'],
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
    expectations: template.expectations,
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
