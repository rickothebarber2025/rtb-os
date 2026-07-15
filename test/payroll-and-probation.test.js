import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateEntryValues,
  calculateRunTotals,
  createCorrectionDraft,
  createDraftEntry,
  getMissingPayrollStaff,
  getPayrollReplacementMap,
  sortPayrollRunsByWeekAsc,
  splitPayrollRunsByVoidStatus,
} from '../src/utils/payroll.js';
import { buildOperationalChecks, daysSince } from '../src/utils/operations.js';
import {
  OPERATION_CHECKLISTS,
  createDefaultOperationsState,
  getChecklistProgress,
  normalizeOperationsState,
} from '../src/utils/operationsManual.js';
import {
  buildSystemChecks,
  createBackupSnapshot,
  flattenPayrollEntries,
  toCsv,
} from '../src/utils/systemTools.js';
import {
  buildActionCenterItems,
  getActionCenterSummary,
  normalizeActionCenterState,
} from '../src/utils/actionCenter.js';
import {
  getProbationInfo,
  toGraduationPayload,
  toProbationPayload,
} from '../src/utils/probation.js';
import {
  applyBooksyImportReview,
  createBooksyImportReview,
  mergeRememberedImportMappings,
  normalizeImportName,
} from '../src/utils/importMappings.js';
import {
  ALL_BUSINESSES_ID,
  canUseAllBusinesses,
  getAccessibleBusinessUnits,
  getBusinessProfile,
  getBusinessSelectionOptions,
  normalizeBusinessProfiles,
  suggestInstagramHandle,
} from '../src/utils/businessProfiles.js';
import { NAV_ITEMS } from '../src/utils/constants.js';
import {
  ALL_BUSINESSES_ACCESS,
  createModulePermissions,
  getEffectivePermissionsPayload,
  getProfileExpectations,
  getProfileBusinessUnitIds,
  profileCanAccessBusiness,
} from '../src/lib/permissions.js';
import { buildPermissionsFromTemplate } from '../src/lib/roleTemplates.js';
import {
  canAccessPage,
  canDeleteBoothRent,
  canManageOperations,
  canManagePerformance,
  canManageAccess,
  canUseApp,
  canUsePayroll,
} from '../src/utils/access.js';
import {
  buildConsultantRecommendations,
  buildStaffPerformanceFeedback,
  calculateFeedbackMetrics,
  groupRecurringIssues,
} from '../src/utils/customerIntelligence.js';
import {
  enrichStaffWithBusinessMetadata,
  staffBelongsToBusiness,
} from '../src/utils/staffBusiness.js';
import { buildRoleWorkspace } from '../src/utils/workspaces.js';

function profileWithPermissions(modules, extra = {}) {
  return {
    active: true,
    permissions: {
      modules: {
        ...createModulePermissions(),
        ...modules,
      },
    },
    ...extra,
  };
}

test('explicit permissions are required for app and page access', () => {
  const dashboardViewer = profileWithPermissions({ dashboard: 'view' });
  const accessEditor = profileWithPermissions({ access: 'edit' });
  const accessAdmin = profileWithPermissions({ access: 'admin' });
  const payrollViewer = profileWithPermissions({ payroll: 'view' });
  const boothEditor = profileWithPermissions({ booth_rent: 'edit' });
  const boothAdmin = profileWithPermissions({ booth_rent: 'admin' });
  const operationsViewer = profileWithPermissions({ operations: 'view' });
  const operationsEditor = profileWithPermissions({ operations: 'edit' });
  const performanceViewer = profileWithPermissions({ performance: 'view' });
  const performanceEditor = profileWithPermissions({ performance: 'edit' });

  assert.equal(canUseApp({ active: true, role: 'manager' }), false);
  assert.equal(canUseApp(dashboardViewer), true);
  assert.equal(canAccessPage(dashboardViewer, 'dashboard'), true);
  assert.equal(canAccessPage(dashboardViewer, 'access'), false);
  assert.equal(canManageAccess(accessEditor), false);
  assert.equal(canManageAccess(accessAdmin), true);
  assert.equal(canUsePayroll(payrollViewer), true);
  assert.equal(canDeleteBoothRent(boothEditor), false);
  assert.equal(canDeleteBoothRent(boothAdmin), true);
  assert.equal(canAccessPage(operationsViewer, 'operations'), true);
  assert.equal(canManageOperations(operationsViewer), false);
  assert.equal(canManageOperations(operationsEditor), true);
  assert.equal(canAccessPage(performanceViewer, 'customer-intelligence'), true);
  assert.equal(canManagePerformance(performanceViewer), false);
  assert.equal(canManagePerformance(performanceEditor), true);
});

test('legacy null permissions get temporary role fallback only until saved', () => {
  const legacyManager = {
    active: true,
    business_unit_id: 'beauty',
    permissions: null,
    role: 'manager',
  };
  const savedManager = {
    active: true,
    business_unit_id: 'beauty',
    permissions: buildPermissionsFromTemplate('custom'),
    role: 'manager',
  };

  assert.equal(canUseApp({ active: true, role: 'manager' }), false);
  assert.equal(canAccessPage(legacyManager, 'staff'), true);
  assert.equal(canAccessPage(legacyManager, 'access'), false);
  assert.equal(canUseApp(savedManager), false);
  assert.equal(getEffectivePermissionsPayload(legacyManager).role_template, 'legacy_manager');
});

test('role templates carry expectations and module permissions', () => {
  const appointmentCoordinator = {
    active: true,
    permissions: buildPermissionsFromTemplate('appointment_coordinator', {
      business_unit_ids: ['beauty'],
    }),
  };

  assert.equal(canAccessPage(appointmentCoordinator, 'insights'), true);
  assert.equal(canUsePayroll(appointmentCoordinator), false);
  assert.match(getProfileExpectations(appointmentCoordinator), /appointment data/i);
});

test('staff portal template lets invited staff sign in without admin access', () => {
  const staffPortal = {
    active: true,
    business_unit_id: 'beauty',
    permissions: buildPermissionsFromTemplate('staff_portal', {
      business_unit_ids: ['beauty'],
    }),
  };

  assert.equal(canUseApp(staffPortal), true);
  assert.equal(canAccessPage(staffPortal, 'staff-hub'), true);
  assert.equal(canAccessPage(staffPortal, 'my-role'), false);
  assert.equal(canAccessPage(staffPortal, 'staff'), false);
  assert.equal(canAccessPage(staffPortal, 'payroll'), false);
  assert.equal(canAccessPage(staffPortal, 'performance'), false);
  assert.equal(canAccessPage(staffPortal, 'access'), false);
  assert.equal(canUsePayroll(staffPortal), false);
  assert.equal(canManageAccess(staffPortal), false);
  assert.equal(getEffectivePermissionsPayload(staffPortal).role_title, 'Staff Portal');
});

test('active staff with blank access is automatically treated as Staff Portal', () => {
  const emptyCustomStaff = {
    active: true,
    business_unit_id: 'beauty',
    permissions: buildPermissionsFromTemplate('custom', {
      business_unit_ids: ['beauty'],
    }),
    role: 'staff',
  };
  const legacyNullStaff = {
    active: true,
    business_unit_id: 'lounge',
    permissions: null,
    role: 'staff',
  };

  assert.equal(canUseApp(emptyCustomStaff), true);
  assert.equal(canAccessPage(emptyCustomStaff, 'staff-hub'), true);
  assert.equal(canAccessPage(emptyCustomStaff, 'access'), false);
  assert.equal(getEffectivePermissionsPayload(emptyCustomStaff).role_template, 'staff_portal');
  assert.equal(canUseApp(legacyNullStaff), true);
  assert.equal(canAccessPage(legacyNullStaff, 'staff-hub'), true);
  assert.equal(getEffectivePermissionsPayload(legacyNullStaff).role_title, 'Staff Portal');
});

test('role workspace surfaces allowed role-specific actions', () => {
  const appointmentCoordinator = {
    active: true,
    business_unit_id: 'beauty',
    permissions: buildPermissionsFromTemplate('appointment_coordinator', {
      business_unit_ids: ['beauty'],
    }),
  };
  const allowedNav = NAV_ITEMS.filter((item) => canAccessPage(appointmentCoordinator, item.id));
  const workspace = buildRoleWorkspace(
    appointmentCoordinator,
    allowedNav,
    { id: 'beauty', name: 'RTB Beauty Lounge' },
  );

  assert.equal(workspace.title, 'Appointment Coordination Workspace');
  assert.equal(workspace.focusPages.some((page) => page.id === 'insights'), true);
  assert.equal(workspace.focusPages.some((page) => page.id === 'payroll'), false);
  assert.equal(workspace.onboarding.every((item) => item.complete), true);
});

test('staff portal workspace focuses on staff self-service pages', () => {
  const staffPortal = {
    active: true,
    business_unit_id: 'beauty',
    permissions: buildPermissionsFromTemplate('staff_portal', {
      business_unit_ids: ['beauty'],
    }),
  };
  const allowedNav = NAV_ITEMS.filter((item) => canAccessPage(staffPortal, item.id));
  const workspace = buildRoleWorkspace(
    staffPortal,
    allowedNav,
    { id: 'beauty', name: 'RTB Beauty Lounge' },
  );

  assert.equal(workspace.title, 'Staff Portal');
  assert.equal(workspace.focusPages.some((page) => page.id === 'staff-hub'), true);
  assert.equal(workspace.focusPages.some((page) => page.id === 'access'), false);
  assert.equal(workspace.editableModules.length, 0);
});

test('business access can be one business, many businesses, or all businesses', () => {
  const businessUnits = [
    { id: 'lounge', name: 'RTB Lounge' },
    { id: 'beauty', name: 'RTB Beauty Lounge' },
    { id: 'training', name: 'Training Studio' },
  ];
  const legacySingle = profileWithPermissions(
    { dashboard: 'view' },
    { business_unit_id: 'lounge' },
  );
  const multiBusiness = profileWithPermissions(
    { dashboard: 'view' },
    {
      permissions: {
        business_unit_ids: ['lounge', 'beauty'],
        modules: {
          ...createModulePermissions(),
          dashboard: 'view',
        },
      },
    },
  );
  const allBusinessAdmin = profileWithPermissions(
    { access: 'admin', dashboard: 'view' },
    {
      permissions: {
        business_scope: 'all',
        business_unit_ids: [ALL_BUSINESSES_ACCESS],
        modules: {
          ...createModulePermissions(),
          access: 'admin',
          dashboard: 'view',
        },
      },
    },
  );

  assert.deepEqual(getProfileBusinessUnitIds(legacySingle), ['lounge']);
  assert.equal(profileCanAccessBusiness(multiBusiness, 'beauty'), true);
  assert.equal(profileCanAccessBusiness(multiBusiness, 'training'), false);
  assert.deepEqual(
    getAccessibleBusinessUnits(businessUnits, multiBusiness).map((unit) => unit.id),
    ['lounge', 'beauty'],
  );
  assert.deepEqual(
    getBusinessSelectionOptions(businessUnits, legacySingle).map((unit) => unit.id),
    ['lounge'],
  );
  assert.equal(canUseAllBusinesses(allBusinessAdmin, businessUnits), true);
  assert.equal(getBusinessSelectionOptions(businessUnits, allBusinessAdmin)[0].id, ALL_BUSINESSES_ID);
});

test('commission drops to 55% below $500 for non-fixed staff', () => {
  const result = calculateEntryValues({
    baseCommissionRate: 60,
    fixedRate: false,
    netSales: 400,
    tips: 20,
  });

  assert.equal(result.adjusted, true);
  assert.equal(result.appliedCommissionRate, 55);
  assert.equal(result.deduction, 5);
  assert.equal(result.takeHome, 235);
});

test('fixed-rate staff below $500 lose five commission points', () => {
  const result = calculateEntryValues({
    baseCommissionRate: 65,
    fixedRate: true,
    netSales: 250,
    tips: 0,
  });

  assert.equal(result.adjusted, true);
  assert.equal(result.appliedCommissionRate, 60);
  assert.equal(result.takeHome, 145);
});

test('fixed-rate staff at or above $500 keep their fixed commission', () => {
  const result = calculateEntryValues({
    baseCommissionRate: 65,
    fixedRate: true,
    netSales: 500,
    tips: 0,
  });

  assert.equal(result.adjusted, false);
  assert.equal(result.appliedCommissionRate, 65);
  assert.equal(result.takeHome, 320);
});

test('empty payroll entries never create negative payout or phantom deductions', () => {
  const entry = calculateEntryValues({
    baseCommissionRate: 60,
    fixedRate: false,
    netSales: 0,
    tips: 0,
  });
  const totals = calculateRunTotals({
    entries: [
      {
        applied_commission_rate: entry.appliedCommissionRate,
        deduction: entry.deduction,
        net_sales: 0,
        take_home: entry.takeHome,
      },
    ],
    ownerNetSales: 0,
  });

  assert.equal(entry.deduction, 0);
  assert.equal(entry.takeHome, 0);
  assert.equal(totals.totalDeductions, 0);
  assert.equal(totals.totalStaffPayout, 0);
  assert.equal(totals.rtbNet, 0);
});

test('probation uses its own start date and preserves employment start', () => {
  const staff = {
    active: true,
    full_name: 'Test Staff',
    start_date: '2025-01-15',
    tier: 'standard',
  };
  const probation = toProbationPayload(staff, '2026-06-01');
  const info = getProbationInfo(probation, new Date(2026, 6, 1));
  const graduated = toGraduationPayload(probation, new Date(2026, 6, 1));

  assert.equal(probation.start_date, '2025-01-15');
  assert.equal(probation.probation_start_date, '2026-06-01');
  assert.equal(info.endDateKey, '2026-08-30');
  assert.equal(graduated.tier, 'standard');
  assert.equal(graduated.commission_rate, 60);
  assert.match(graduated.notes, /Graduated from probation on 2026-07-01/);
});

test('operational checks flag stale payroll and disconnected Square', () => {
  const now = new Date('2026-06-19T12:00:00Z');
  const checks = buildOperationalChecks({
    activeStaffCount: 4,
    appointmentUpdatedAt: null,
    boothRentCount: 0,
    businessUnitName: 'RTB Beauty Lounge',
    latestRun: { week_end: '2026-06-07', week_label: 'Jun 1 - Jun 7' },
    payrollAllowed: true,
    squareStatus: { connected: false },
    now,
  });

  assert.equal(daysSince('2026-06-07', now), 12);
  assert.equal(checks.find((check) => check.label === 'Payroll').tone, 'warning');
  assert.equal(checks.find((check) => check.label === 'Square Appointments').tone, 'danger');
});

test('payroll correction keeps values but removes saved record identifiers', () => {
  const correction = createCorrectionDraft(
    {
      id: 'run-1',
      notes: 'Original note',
      performance_saved_at: '2026-06-01T00:00:00Z',
      status: 'locked',
      week_label: 'Jun 1 - Jun 7',
    },
    [
      {
        id: 'entry-1',
        net_sales: 750,
        payroll_run_id: 'run-1',
        paystub_status: 'sent',
        staff_id: 'staff-1',
      },
    ],
    'Wrong sales amount',
  );

  assert.equal(correction.run.id, undefined);
  assert.equal(correction.run.corrected_from_run_id, 'run-1');
  assert.equal(correction.run.status, 'draft');
  assert.match(correction.run.notes, /Wrong sales amount/);
  assert.equal(correction.entries[0].id, undefined);
  assert.equal(correction.entries[0].payroll_run_id, undefined);
  assert.equal(correction.entries[0].net_sales, 750);
  assert.equal(correction.entries[0].paystub_status, 'pending');
});

test('saved payroll drafts can detect and add missing active staff', () => {
  const staff = [
    {
      active: true,
      commission_rate: 60,
      fixed_rate: false,
      full_name: 'Ricko Joseph',
      id: 'staff-ricko',
      role: 'Barber',
      tier: 'standard',
    },
    {
      active: true,
      commission_rate: 65,
      fixed_rate: true,
      full_name: 'Sara Hairstylist',
      id: 'staff-sara',
      role: 'Hairstylist',
      tier: 'standard',
    },
  ];
  const draftEntries = [createDraftEntry(staff[0])];
  const missing = getMissingPayrollStaff(staff, draftEntries);
  const repairedEntries = [...draftEntries, ...missing.map(createDraftEntry)];

  assert.deepEqual(missing.map((member) => member.full_name), ['Sara Hairstylist']);
  assert.equal(getMissingPayrollStaff(staff, repairedEntries).length, 0);
  assert.equal(repairedEntries[1].staff_id, 'staff-sara');
  assert.equal(repairedEntries[1].fixed_rate_snapshot, true);
});

test('payroll history separates voided correction records from active runs', () => {
  const runs = [
    { id: 'draft-1', status: 'draft', week_label: 'Draft week' },
    { id: 'void-1', status: 'voided', week_label: 'Voided week' },
    {
      corrected_from_run_id: 'void-1',
      id: 'replacement-1',
      status: 'draft',
      week_label: 'Replacement week',
    },
  ];
  const { activeRuns, voidedRuns } = splitPayrollRunsByVoidStatus(runs);
  const replacements = getPayrollReplacementMap(runs);

  assert.deepEqual(activeRuns.map((run) => run.id), ['draft-1', 'replacement-1']);
  assert.deepEqual(voidedRuns.map((run) => run.id), ['void-1']);
  assert.equal(replacements.get('void-1').id, 'replacement-1');
});

test('payroll history sorts by payroll week instead of save date', () => {
  const runs = [
    {
      created_at: '2026-07-03T12:00:00Z',
      id: 'jun-29',
      week_label: 'Jun 29 - Jul 5',
      week_start: '2026-06-29',
    },
    {
      created_at: '2026-07-01T12:00:00Z',
      id: 'jun-8',
      week_label: 'Jun 8 - Jun 14',
      week_start: '2026-06-08',
    },
    {
      created_at: '2026-07-03T10:00:00Z',
      id: 'jun-1',
      week_label: 'Jun 1 - Jun 7',
      week_start: '2026-06-01',
    },
    {
      created_at: '2026-07-02T12:00:00Z',
      id: 'jun-15',
      week_label: 'Jun 15 - Jun 21',
      week_start: '2026-06-15',
    },
  ];

  assert.deepEqual(
    sortPayrollRunsByWeekAsc(runs).map((run) => run.id),
    ['jun-1', 'jun-8', 'jun-15', 'jun-29'],
  );
});

test('operations extension normalizes saved checklist data', () => {
  const defaults = createDefaultOperationsState();
  const normalized = normalizeOperationsState({
    changelog: [{ date: 'Jun 2026', note: 'Imported extension' }],
    checklists: {
      opening: [true],
    },
    hires: [{ id: 'hire-1', name: 'Test Staff' }],
  });
  const openingProgress = getChecklistProgress(
    OPERATION_CHECKLISTS.opening.items,
    normalized.checklists.opening,
  );

  assert.equal(defaults.checklists.opening.length, OPERATION_CHECKLISTS.opening.items.length);
  assert.equal(normalized.checklists.opening[0], true);
  assert.equal(normalized.checklists.opening[1], false);
  assert.equal(normalized.hires[0].name, 'Test Staff');
  assert.equal(openingProgress.done, 1);
});

test('system tools create backups and CSV exports without leaking secrets', () => {
  const snapshot = createBackupSnapshot({
    accessProfile: profileWithPermissions({ access: 'admin' }, { role: 'admin' }),
    boothRent: [{ renter_name: 'Tara', rent_amount: 200 }],
    businessUnit: { name: 'RTB Lounge' },
    businessUnits: [{ name: 'RTB Lounge' }],
    payrollRuns: [
      {
        payroll_entries: [
          {
            applied_commission_rate: 60,
            deduction: 5,
            net_sales: 1000,
            staff_name_snapshot: 'Ricko',
            take_home: 595,
          },
        ],
        status: 'locked',
        week_label: 'Jun 1 - Jun 7',
      },
    ],
    staff: [{ active: true, full_name: 'Ricko' }],
    user: { email: 'owner@example.com' },
  });
  const entries = flattenPayrollEntries(snapshot.tables.payrollRuns);
  const csv = toCsv([{ name: 'A, B', note: 'quoted "value"' }]);

  assert.equal(snapshot.kind, 'rtb-os-backup-v1');
  assert.equal(snapshot.summary.activeStaff, 1);
  assert.equal(entries[0].run_week, 'Jun 1 - Jun 7');
  assert.match(csv, /"A, B"/);
  assert.match(csv, /"quoted ""value"""/);
  assert.equal(JSON.stringify(snapshot).includes('service_role'), false);
});

test('system checks flag overdue probation and missing appointment source', () => {
  const checks = buildSystemChecks({
    accessProfile: profileWithPermissions({ payroll: 'view' }),
    businessUnit: { name: 'RTB Beauty Lounge' },
    masterDashboard: null,
    payrollRuns: [],
    squareStatus: { connected: false },
    staff: [
      {
        active: true,
        full_name: 'Probation Staff',
        probation_start_date: '2026-01-01',
        tier: 'probation',
      },
    ],
    now: new Date('2026-06-28T12:00:00Z'),
  });

  assert.equal(checks.find((check) => check.label === 'Probation').tone, 'warning');
  assert.equal(checks.find((check) => check.label === 'Square connection').tone, 'danger');
  assert.equal(checks.find((check) => check.label === 'Square appointments').tone, 'warning');
});

test('action center surfaces automatic operational work', () => {
  const items = buildActionCenterItems({
    accessProfile: profileWithPermissions({ payroll: 'view' }),
    boothRent: [
      {
        created_at: '2026-06-10T12:00:00Z',
        paid: false,
        rent_amount: 200,
        renter_name: 'Tara',
      },
    ],
    payrollRuns: [
      {
        status: 'draft',
        week_label: 'Jun 22 - Jun 28',
      },
    ],
    staff: [
      {
        active: true,
        full_name: 'Josh',
        id: 'staff-josh',
        probation_start_date: '2026-04-04',
        tier: 'probation',
      },
    ],
    now: new Date('2026-06-28T12:00:00Z'),
  });

  assert.equal(items.some((item) => item.category === 'probation'), true);
  assert.equal(items.some((item) => item.category === 'payroll'), true);
  assert.equal(items.some((item) => item.category === 'booth'), true);
  assert.match(items.find((item) => item.category === 'probation').title, /Josh/);
});

test('action center tracks warnings and missing documents for the selected roster', () => {
  const actionCenter = normalizeActionCenterState({
    documents: [
      {
        document_name: 'Commission agreement',
        due_date: '2026-06-20',
        id: 'doc-steph',
        staff_id: 'staff-steph',
        staff_name: 'Steph',
      },
      {
        document_name: 'Other business document',
        due_date: '2026-06-20',
        id: 'doc-other',
        staff_id: 'staff-other-business',
        staff_name: 'Other Business Staff',
      },
    ],
    warnings: [
      {
        date: '2026-06-01',
        id: 'warning-1',
        staff_id: 'staff-steph',
        staff_name: 'Steph',
      },
      {
        date: '2026-06-18',
        id: 'warning-2',
        staff_id: 'staff-steph',
        staff_name: 'Steph',
      },
    ],
  });
  const items = buildActionCenterItems({
    actionCenter,
    staff: [{ active: true, full_name: 'Steph', id: 'staff-steph' }],
    now: new Date('2026-06-28T12:00:00Z'),
  });
  const summary = getActionCenterSummary(items);

  assert.equal(items.filter((item) => item.category === 'warning').length, 1);
  assert.equal(items.filter((item) => item.category === 'docs').length, 1);
  assert.equal(items.some((item) => item.title.includes('Other Business Staff')), false);
  assert.equal(summary.total, 2);
  assert.equal(summary.manual, 2);
});

test('booksy import matching ignores case spaces and punctuation', () => {
  assert.equal(normalizeImportName('Ricko Joseph'), 'rickojoseph');
  assert.equal(normalizeImportName(' RICKO-JOSEPH '), 'rickojoseph');

  const review = createBooksyImportReview({
    dashboard: {
      services: [{ name: 'Hair Cut', revenue: 100 }],
      staff: [{ name: 'RICKO-JOSEPH', revenue: 100 }],
    },
    existingDashboard: {
      services: [{ name: 'Haircut' }],
    },
    mappings: null,
    staff: [{ active: true, full_name: 'Ricko Joseph', id: 'staff-ricko' }],
  });

  assert.equal(review.staffReview[0].matchType, 'exact');
  assert.equal(review.staffReview[0].targetId, 'staff-ricko');
  assert.equal(review.serviceReview[0].matchType, 'exact');
  assert.equal(review.serviceReview[0].targetName, 'Haircut');
});

test('booksy import remembers aliases and applies them to dashboard rows', () => {
  const review = createBooksyImportReview({
    dashboard: {
      recentTransactions: [
        { service: 'Mens Cut', staffer: 'Sara | Hairstylist' },
      ],
      services: [
        { cancelled: 0, count: 1, name: 'Mens Cut', revenue: 50 },
      ],
      staff: [
        { appointments: 1, mayAppointments: 0, name: 'Sara | Hairstylist', revenue: 50 },
      ],
    },
    existingDashboard: {
      services: [{ name: 'Men Haircut' }],
    },
    mappings: {
      services: {
        menscut: {
          action: 'match',
          sourceName: 'Mens Cut',
          targetName: 'Men Haircut',
        },
      },
      staff: {
        sarahairstylist: {
          action: 'match',
          sourceName: 'Sara | Hairstylist',
          targetId: 'staff-sara',
          targetName: 'Sara',
        },
      },
    },
    staff: [{ active: true, full_name: 'Sara', id: 'staff-sara' }],
  });

  const dashboard = applyBooksyImportReview(
    review.dashboard,
    review.staffReview,
    review.serviceReview,
  );
  const mappings = mergeRememberedImportMappings(
    review.mappings,
    review.staffReview,
    review.serviceReview,
  );

  assert.equal(review.staffReview[0].matchType, 'remembered');
  assert.equal(dashboard.staff[0].name, 'Sara');
  assert.equal(dashboard.services[0].name, 'Men Haircut');
  assert.equal(dashboard.recentTransactions[0].staffer, 'Sara');
  assert.equal(dashboard.recentTransactions[0].service, 'Men Haircut');
  assert.equal(mappings.staff.sarahairstylist.targetName, 'Sara');
});

test('business profiles define separate platform and branding rules', () => {
  const lounge = getBusinessProfile({ name: 'RTB Lounge' });
  const beauty = getBusinessProfile({ name: 'RTB Beauty Lounge' });
  const allBusinessAdmin = profileWithPermissions(
    { access: 'admin' },
    {
      permissions: {
        business_scope: 'all',
        business_unit_ids: [ALL_BUSINESSES_ACCESS],
        modules: {
          ...createModulePermissions(),
          access: 'admin',
        },
      },
    },
  );
  const options = getBusinessSelectionOptions([{ id: 'rtb', name: 'RTB Lounge' }], allBusinessAdmin);

  assert.equal(lounge.booking_platform, 'Booksy');
  assert.equal(lounge.pos_platform, 'Square');
  assert.deepEqual(lounge.staff_roles, ['Barber', 'Hairstylist']);
  assert.equal(beauty.booking_platform, 'Square Appointments');
  assert.equal(beauty.pos_platform, 'Square');
  assert.deepEqual(beauty.staff_roles, ['Nail Tech', 'Lash Tech']);
  assert.equal(suggestInstagramHandle('Josh Smith', lounge.instagram_format), 'josh.rtb_lounge');
  assert.equal(suggestInstagramHandle('Josh Smith', 'firstnamelastname'), 'joshsmith');
  assert.equal(canUseAllBusinesses(profileWithPermissions({ access: 'edit' })), false);
  assert.equal(options[0].id, ALL_BUSINESSES_ID);
});

test('business profile overrides cannot reintroduce retired staff roles', () => {
  const profiles = normalizeBusinessProfiles({
    'RTB Lounge': {
      staff_roles: ['Master Barber', 'Booth Renter', 'Barber'],
    },
    'RTB Beauty Lounge': {
      staff_roles: ['Nail Tech', 'Brow Tech', 'Esthetician'],
    },
  });

  assert.deepEqual(profiles['RTB Lounge'].staff_roles, ['Barber', 'Hairstylist']);
  assert.deepEqual(profiles['RTB Beauty Lounge'].staff_roles, ['Nail Tech', 'Lash Tech']);
});

test('staff metadata supports both-business assignment without duplicating staff', () => {
  const businessUnits = [
    { id: 'lounge', name: 'RTB Lounge' },
    { id: 'beauty', name: 'RTB Beauty Lounge' },
  ];
  const [member] = enrichStaffWithBusinessMetadata(
    [
      {
        active: true,
        business_unit_id: 'lounge',
        fixed_rate: false,
        full_name: 'Sara Hairstylist',
        id: 'staff-sara',
        tier: 'standard',
      },
    ],
    {
      'staff-sara': {
        assigned_business_ids: ['lounge', 'beauty'],
        booking_platform_profile: 'Sara | Hairstylist',
        instagram_rule: 'firstnamelastname',
        pos_profile: 'Sara Square',
      },
    },
    businessUnits,
  );

  assert.equal(member.instagram_handle, 'sarahairstylist');
  assert.equal(member.booking_platform_profile, 'Sara | Hairstylist');
  assert.equal(member.pos_profile, 'Sara Square');
  assert.equal(staffBelongsToBusiness(member, 'lounge'), true);
  assert.equal(staffBelongsToBusiness(member, 'beauty'), true);
  assert.deepEqual(member.assigned_business_names, ['RTB Lounge', 'RTB Beauty Lounge']);
});

test('customer intelligence calculates satisfaction, NPS, and response rate', () => {
  const metrics = calculateFeedbackMetrics({
    requests: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }],
    responses: [
      { feedback_response_id: 'f1', overall_rating: 5, recommend_business: 10 },
      { feedback_response_id: 'f2', overall_rating: 4, recommend_business: 9 },
      { feedback_response_id: 'f3', overall_rating: 2, recommend_business: 4 },
    ],
  });

  assert.equal(metrics.completedResponses, 3);
  assert.equal(metrics.responseRate, 75);
  assert.equal(metrics.customerSatisfaction, 66.7);
  assert.equal(metrics.npsScore, 33.3);
});

test('customer intelligence groups recurring issues from feedback analysis', () => {
  const issues = groupRecurringIssues([
    {
      main_category: 'Reception Experience',
      priority: 'medium',
      response_created_at: '2026-06-01T12:00:00Z',
      summary: 'Reception was confusing.',
    },
    {
      main_category: 'Reception Experience',
      priority: 'high',
      response_created_at: '2026-06-10T12:00:00Z',
      summary: 'No one greeted the customer.',
    },
    {
      main_category: 'Atmosphere',
      priority: 'low',
      response_created_at: '2026-06-10T12:00:00Z',
      summary: 'Music was good.',
    },
  ]);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, 'Reception Experience');
  assert.equal(issues[0].count, 2);
  assert.equal(issues[0].priority, 'high');
});

test('AI consultant fallback prioritizes recurring projects and delegation', () => {
  const recommendation = buildConsultantRecommendations({
    feedback: [],
    projects: [
      {
        estimated_cost: 'Low',
        estimated_revenue_impact: 'High',
        priority: 'high',
        reason: 'Mentioned by 12 customers.',
        status: 'open',
        title: 'Improve Reception Experience',
      },
    ],
    sources: [{ source_type: 'meeting_note', title: 'Team meeting note' }],
  });

  assert.equal(recommendation.fixFirst, 'Improve Reception Experience');
  assert.equal(recommendation.highestRoi, 'Improve Reception Experience');
  assert.equal(recommendation.lowestCost, 'Improve Reception Experience');
  assert.equal(recommendation.delegateRecommendations.length, 1);
});

test('staff performance feedback generates coaching recommendations from performance data', () => {
  const rows = [
    {
      staff_id: 'staff-1',
      full_name: 'Ari Barber',
      role: 'Barber',
      total_net_sales: 2480,
      total_tips: 120,
      under_minimum_weeks: 1,
      avg_weekly_net: 620,
      best_week_net: 950,
      weeks_recorded: 4,
      fixed_rate: false,
    },
    {
      staff_id: 'staff-2',
      full_name: 'Mia Stylist',
      role: 'Hairstylist',
      total_net_sales: 4900,
      total_tips: 760,
      under_minimum_weeks: 0,
      avg_weekly_net: 980,
      best_week_net: 1100,
      weeks_recorded: 5,
      fixed_rate: true,
    },
  ];

  const feedback = buildStaffPerformanceFeedback(rows, []);

  assert.equal(feedback.length, 2);
  assert.equal(feedback[0].staff_id, 'staff-1');
  assert.equal(feedback[0].priority, 'high');
  assert.match(feedback[0].summary, /under the \$500 floor/i);
  assert.match(feedback[0].growthTip, /pre-book the next cut/i);
  assert.match(feedback[0].tipTip, /tips are only/i);

  assert.equal(feedback[1].staff_id, 'staff-2');
  assert.equal(feedback[1].priority, 'low');
  assert.match(feedback[1].summary, /strong and steady/i);
  assert.match(feedback[1].growthTip, /maintenance schedule/i);
  assert.match(feedback[1].tipTip, /Tips are strong/i);
});
