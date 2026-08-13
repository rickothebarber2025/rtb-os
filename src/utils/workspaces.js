import { NAV_ITEMS } from './constants.js';
import {
  getEffectivePermissionsPayload,
  getModulePermission,
  hasAllBusinessAccess,
  isOwnerProfile,
  MODULE_LABELS,
} from '../lib/permissions.js';

const PAGE_BY_MODULE = {
  access: 'access',
  appointments: 'insights',
  booth_rent: 'booth-rent',
  dashboard: 'dashboard',
  operations: 'operations',
  payroll: 'payroll',
  performance: 'performance',
  roster: 'staff',
  settings: 'system',
  staff_hub: 'staff-hub',
};

const WORKSPACE_PRESETS = {
  appointment_coordinator: {
    description: 'Stay on top of appointment imports, no-shows, and schedule issues.',
    focus: ['insights', 'action-center', 'staff', 'operations'],
    title: 'Appointment Coordination Workspace',
  },
  barbershop_manager: {
    description: 'Run RTB Lounge operations with Booksy imports, roster updates, and rent follow-up.',
    focus: ['action-center', 'insights', 'staff', 'booth-rent', 'performance'],
    title: 'Barbershop Manager Workspace',
  },
  beauty_manager: {
    description: 'Run RTB Beauty Lounge operations with Square Appointments, roster, and performance follow-up.',
    focus: ['action-center', 'insights', 'staff', 'performance', 'booth-rent'],
    title: 'Beauty Manager Workspace',
  },
  content_marketing: {
    description: 'Find staff highlights, customer signals, and service trends for content planning.',
    focus: ['customer-intelligence', 'performance', 'insights', 'operations'],
    title: 'Content Workspace',
  },
  full_admin: {
    description: 'Manage the full RTB OS operating system, access, corrections, and reporting.',
    focus: ['action-center', 'access', 'system', 'payroll', 'operations'],
    title: 'Admin Command Center',
  },
  operations_assistant: {
    description: 'Keep checklists, SOPs, documents, and open issues organized.',
    focus: ['action-center', 'operations', 'staff', 'performance'],
    title: 'Operations Workspace',
  },
  operations_cleaning: {
    description: 'Complete whole-shop cleaning, restocking, inventory checks, issue reporting, and final walkthroughs.',
    focus: ['staff-hub'],
    title: 'Operations Cleaning Workspace',
  },
  owner: {
    description: 'See the highest-impact decisions across access, payroll, operations, and performance.',
    focus: ['action-center', 'payroll', 'access', 'ai-consultant', 'system'],
    title: 'Owner Command Center',
  },
  payroll_assistant: {
    description: 'Prepare payroll carefully and flag payout, deduction, or staff record issues.',
    focus: ['payroll', 'action-center', 'staff', 'performance'],
    title: 'Payroll Workspace',
  },
  staff_portal: {
    description: 'Use Staff Hub to review your own profile, earnings, performance, and assigned business.',
    focus: ['staff-hub'],
    title: 'Staff Portal',
  },
  view_only: {
    description: 'Review assigned reports and raise issues without changing records.',
    focus: ['dashboard', 'performance', 'insights', 'operations'],
    title: 'View-Only Workspace',
  },
};

function navLabel(pageId) {
  return NAV_ITEMS.find((item) => item.id === pageId)?.label || pageId;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function pagesFromPermissions(profile) {
  const payload = getEffectivePermissionsPayload(profile);
  return Object.entries(payload.modules)
    .filter(([, level]) => level !== 'none')
    .map(([moduleId]) => PAGE_BY_MODULE[moduleId])
    .filter(Boolean);
}

function inferPreset(profile) {
  const payload = getEffectivePermissionsPayload(profile);
  if (isOwnerProfile(profile)) return WORKSPACE_PRESETS.owner;
  if (WORKSPACE_PRESETS[payload.role_template]) return WORKSPACE_PRESETS[payload.role_template];

  const payroll = getModulePermission(profile, 'payroll');
  const appointments = getModulePermission(profile, 'appointments');
  const operations = getModulePermission(profile, 'operations');
  const access = getModulePermission(profile, 'access');

  if (access === 'admin') return WORKSPACE_PRESETS.full_admin;
  if (payroll === 'edit' || payroll === 'admin') return WORKSPACE_PRESETS.payroll_assistant;
  if (appointments === 'edit' || appointments === 'admin') return WORKSPACE_PRESETS.appointment_coordinator;
  if (operations === 'edit' || operations === 'admin') return WORKSPACE_PRESETS.operations_assistant;
  return WORKSPACE_PRESETS.view_only;
}

export function buildRoleWorkspace(profile, navItems = [], businessUnit = null) {
  const payload = getEffectivePermissionsPayload(profile);
  const preset = inferPreset(profile);
  const allowedPageIds = new Set(navItems.map((item) => item.id));
  const includeMyRole = !['staff_portal', 'operations_cleaning'].includes(payload.role_template);
  const focusPages = unique([
    ...preset.focus,
    ...pagesFromPermissions(profile),
    ...(includeMyRole ? ['my-role'] : []),
  ])
    .filter((pageId) => allowedPageIds.has(pageId))
    .slice(0, 6);
  const editableModules = Object.entries(payload.modules)
    .filter(([, level]) => level === 'edit' || level === 'admin')
    .map(([moduleId]) => MODULE_LABELS[moduleId]);
  const visibleModules = Object.entries(payload.modules)
    .filter(([, level]) => level !== 'none')
    .map(([moduleId]) => MODULE_LABELS[moduleId]);

  const onboarding = [
    {
      complete: visibleModules.length > 0,
      detail: visibleModules.length ? `${visibleModules.length} modules assigned` : 'Ask an access admin to assign module permissions.',
      label: 'Module access',
    },
    {
      complete: isOwnerProfile(profile) || hasAllBusinessAccess(profile) || Boolean(profile?.business_unit_id),
      detail: isOwnerProfile(profile) || hasAllBusinessAccess(profile) ? 'All businesses' : businessUnit?.name || 'Choose a business in Access',
      label: 'Business scope',
    },
    {
      complete: payload.responsibilities.length > 0,
      detail: payload.responsibilities.length ? `${payload.responsibilities.length} responsibilities listed` : 'Add responsibilities so the user knows what to own.',
      label: 'Responsibilities',
    },
  ];

  return {
    description: preset.description,
    editableModules,
    focusPages: focusPages.map((pageId) => ({ id: pageId, label: navLabel(pageId) })),
    onboarding,
    responsibilities: payload.responsibilities,
    restrictions: payload.restrictions,
    roleTitle: payload.role_title,
    title: preset.title,
    visibleModules,
  };
}
