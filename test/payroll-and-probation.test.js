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
import {
  buildCommissionExplanation,
  buildIncomeOpportunity,
  buildMonthlyGoalProgress,
  buildRtbScore,
  buildTodayMoneyStats,
} from '../src/utils/staffHubInsights.js';
import {
  buildDailyOperationsSummary,
  getLatestShopStatus,
  getUnacknowledgedPolicies,
} from '../src/utils/dailyOperations.js';
import { buildRoleWorkspace } from '../src/utils/workspaces.js';
import { parseBooksyCsvRows, parseBooksyEmail } from '../supabase/functions/_shared/booksy-parser.js';
import {
  buildStaffCandidates,
  matchStaffAssignment,
} from '../supabase/functions/_shared/source-attribution.js';

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

test('permission helpers tolerate profile loading states', () => {
  assert.equal(getEffectivePermissionsPayload(null).role_title, 'Custom Role');
  assert.equal(canUseApp(null), false);
  assert.equal(canAccessPage(null, 'dashboard'), false);
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
  assert.equal(workspace.focusPages.some((page) => page.id === 'action-center'), true);
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

test('daily operations summary combines shifts tasks policies and shop status', () => {
  const summary = buildDailyOperationsSummary({
    checklistRuns: [
      {
        checklist_type: 'opening',
        items: [{ completed: true }, { completed: true }],
        run_date: '2026-07-23',
        status: 'completed',
      },
    ],
    operationsRequests: [
      { priority: 'low', status: 'completed', title: 'Done', request_type: 'maintenance' },
      { priority: 'urgent', status: 'pending', title: 'Chair broken', request_type: 'maintenance' },
    ],
    policyAcknowledgements: [{ policy_id: 'policy-1', staff_id: 'staff-1' }],
    policyDocuments: [
      { id: 'policy-1', requires_acknowledgement: true, title: 'Late policy' },
      { id: 'policy-2', requires_acknowledgement: true, title: 'Safety policy' },
    ],
    shiftRecords: [
      {
        checked_in_at: '2026-07-23T13:55:00.000Z',
        late_minutes: 0,
        shift_date: '2026-07-23',
        staff_id: 'staff-1',
        status: 'active',
      },
    ],
    shopStatusEvents: [
      { created_at: '2026-07-23T13:00:00.000Z', status: 'opening' },
      { created_at: '2026-07-23T14:00:00.000Z', status: 'open' },
    ],
    staffId: 'staff-1',
    tasks: [
      { due_date: '2026-07-20', status: 'pending', title: 'Restock towels' },
      { status: 'completed', title: 'Clean station' },
    ],
    today: '2026-07-23',
  });

  assert.equal(summary.todayShift.status, 'active');
  assert.equal(summary.shopStatus.label, 'Open');
  assert.equal(summary.checklistCompletion, 100);
  assert.equal(summary.openRequests[0].title, 'Chair broken');
  assert.equal(summary.unacknowledgedPolicies.length, 1);
  assert.equal(summary.overdueTasks.length, 1);
  assert.equal(summary.operationsScore, 76);
});

test('daily operations helpers sort status and policy acknowledgements safely', () => {
  assert.equal(getLatestShopStatus([]).label, 'Not set');
  assert.deepEqual(
    getUnacknowledgedPolicies(
      [
        { id: 'a', requires_acknowledgement: true },
        { id: 'b', requires_acknowledgement: false },
      ],
      [],
      'staff-1',
    ).map((policy) => policy.id),
    ['a'],
  );
});

test('Booksy email parser extracts appointment and review notifications', () => {
  const appointment = parseBooksyEmail({
    body: [
      'New appointment',
      'Staff: Sara Hairstylist',
      'Client: Client One',
      'Service: Silk press',
      'Appointment date: July 20, 2026',
      'Appointment time: 2:30 PM',
      'Booking ID: BKG-100',
      'Price: $85.00',
      'Location: RTB Lounge',
    ].join('\n'),
    headers: { date: 'Wed, 15 Jul 2026 16:00:00 +0000' },
    messageId: 'gmail-1',
    subject: 'Booksy - New appointment',
    threadId: 'thread-1',
  });
  const review = parseBooksyEmail({
    body: [
      'New review',
      'Reviewer: Client Two',
      'Staff: Nail Tech One',
      'Rating: 5',
      'Review: Loved my nails and the clean space.',
    ].join('\n'),
    headers: { date: 'not-a-real-date' },
    messageId: 'gmail-2',
    subject: 'Booksy - New review',
  });

  assert.equal(appointment.events[0].eventType, 'appointment_created');
  assert.equal(appointment.events[0].bookingIdentifier, 'BKG-100');
  assert.equal(appointment.events[0].staffName, 'Sara Hairstylist');
  assert.equal(appointment.events[0].price, 85);
  assert.equal(review.events[0].eventType, 'new_review');
  assert.equal(review.events[0].rating, 5);
  assert.match(review.events[0].sourceTimestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('Booksy CSV rows use the shared appointment and review event shape', () => {
  const events = parseBooksyCsvRows([
    {
      appointment_id: 'csv-1',
      client_name: 'Client One',
      date_time: '2026-07-20T14:30:00Z',
      price: '$85',
      service: 'Silk press',
      staff: 'Sara Hairstylist',
      status: 'completed',
    },
    {
      id: 'csv-review-1',
      rating: '5',
      review_text: 'Ricko gave a great cut.',
      staff_name: '',
    },
  ]);

  assert.equal(events[0].eventType, 'appointment_created');
  assert.equal(events[0].sourceEventId, 'csv-1');
  assert.equal(events[1].eventType, 'new_review');
  assert.equal(events[1].rating, 5);
});

test('staff assignment matches IDs, emails, names, aliases, and avoids ambiguous guesses', () => {
  const candidates = buildStaffCandidates({
    aliases: [
      { alias: 'Sara | Hairstylist', staff_id: 'sara' },
      { alias: 'Ricko Joseph', staff_id: 'ricko' },
    ],
    identities: [
      {
        business_location: 'RTB Lounge',
        services: ['Haircut'],
        source_display_name: 'Ricko',
        source_email: 'ricko@example.com',
        source_staff_id: 'booksy-ricko',
        staff_id: 'ricko',
      },
      {
        business_location: 'RTB Lounge',
        services: ['Silk press'],
        source_display_name: 'Sara Hairstylist',
        source_email: 'sara@example.com',
        source_staff_id: 'booksy-sara',
        staff_id: 'sara',
      },
    ],
    staff: [
      {
        active: true,
        business_location: 'RTB Lounge',
        business_unit_id: 'lounge',
        email: 'ricko@example.com',
        full_name: 'Ricko Joseph',
        id: 'ricko',
        preferred_name: 'Ricko',
        services_offered: ['Haircut'],
      },
      {
        active: true,
        business_location: 'RTB Lounge',
        business_unit_id: 'lounge',
        email: 'sara@example.com',
        full_name: 'Sara Brown',
        id: 'sara',
        preferred_name: 'Sara',
        services_offered: ['Silk press'],
      },
    ],
  });

  assert.equal(
    matchStaffAssignment({ sourceStaffId: 'booksy-ricko' }, candidates).status,
    'auto_assigned',
  );
  assert.equal(matchStaffAssignment({ staffEmail: 'sara@example.com' }, candidates).staffId, 'sara');
  assert.equal(matchStaffAssignment({ staffName: 'Sara | Hairstylist' }, candidates).confidence, 95);

  const ambiguous = buildStaffCandidates({
    aliases: [],
    identities: [],
    staff: [
      { active: true, full_name: 'Mia Lee', id: 'mia-1' },
      { active: true, full_name: 'Mia Lee', id: 'mia-2' },
    ],
  });
  const ambiguousMatch = matchStaffAssignment({ staffName: 'Mia Lee' }, ambiguous);
  assert.equal(ambiguousMatch.status, 'unresolved');
  assert.equal(ambiguousMatch.staffId, null);
});

test('general Google-style reviews stay business-level when no staff signal exists', () => {
  const candidates = buildStaffCandidates({
    aliases: [{ alias: 'Ricko', staff_id: 'ricko' }],
    staff: [{ active: true, full_name: 'Ricko Joseph', id: 'ricko' }],
  });
  const generalReview = matchStaffAssignment(
    { reviewText: 'Great atmosphere and clean shop.' },
    candidates,
    { allowGeneralBusiness: true },
  );
  const mentionedReview = matchStaffAssignment(
    { reviewText: 'Ricko gave me a sharp haircut.' },
    candidates,
    { allowGeneralBusiness: true },
  );

  assert.equal(generalReview.status, 'general_business');
  assert.equal(generalReview.staffId, null);
  assert.equal(mentionedReview.status, 'flagged_for_audit');
  assert.equal(mentionedReview.staffId, 'ricko');
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

test('action center surfaces automatic payroll and probation work', () => {
  const items = buildActionCenterItems({
    accessProfile: profileWithPermissions({ payroll: 'view' }),
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

test('staff hub income tracker focuses on useful money opportunities', () => {
  const latestEntry = {
    applied_commission_rate: 55,
    base_commission_rate: 60,
    net_sales: 400,
    tips: 40,
  };
  const opportunity = buildIncomeOpportunity(latestEntry);
  assert.equal(opportunity.needToFloor, 100);
  assert.equal(opportunity.potentialExtraCommission, 80);

  const goal = buildMonthlyGoalProgress({
    entries: [
      { net_sales: 900, week_start: '2026-07-01' },
      { net_sales: 700, week_start: '2026-07-08' },
      { net_sales: 999, week_start: '2026-06-25' },
    ],
    goal: 2000,
    today: '2026-07-15',
  });
  assert.equal(goal.currentRevenue, 1600);
  assert.equal(goal.percentComplete, 80);
  assert.equal(Math.round(goal.remaining), 400);

  const today = buildTodayMoneyStats({
    latestEntry,
    rank: 2,
    scheduleRows: [
      { amount: 120, date: '2026-07-15' },
      { amount: 80, date: '2026-07-15T13:00:00Z' },
      { amount: 60, date: '2026-07-14' },
    ],
    today: '2026-07-15',
  });
  assert.equal(today.appointmentsToday, 2);
  assert.equal(today.importedRevenue, 200);
  assert.equal(today.rank, 2);
});

test('staff hub explains commission adjustments clearly', () => {
  const standard = buildCommissionExplanation({
    latestEntry: {
      adjusted: true,
      applied_commission_rate: 55,
      base_commission_rate: 60,
      deduction: 5,
      net_sales: 400,
      take_home: 255,
      tier_snapshot: 'standard',
      tips: 40,
    },
  });

  assert.equal(standard.title, 'Commission adjusted to 55%');
  assert.equal(standard.amountToFloor, 100);
  assert.equal(standard.adjustmentImpact, 20);
  assert.equal(standard.projectedFloorGain, 80);
  assert.equal(standard.takeHome, 255);
  assert.match(standard.message, /\$500/);

  const fixed = buildCommissionExplanation({
    latestEntry: {
      adjusted: true,
      applied_commission_rate: 65,
      base_commission_rate: 70,
      fixed_rate_snapshot: true,
      net_sales: 400,
      tier_snapshot: 'elite',
    },
  });

  assert.equal(fixed.title, 'Fixed commission lowered 5 points');
  assert.equal(fixed.adjustmentPoints, 5);
  assert.match(fixed.message, /Fixed-rate staff/);

  const probation = buildCommissionExplanation({
    latestEntry: {
      adjusted: false,
      applied_commission_rate: 50,
      base_commission_rate: 50,
      net_sales: 400,
      tier_snapshot: 'probation',
    },
  });

  assert.equal(probation.title, 'Probation stays at 50/50');
  assert.equal(probation.adjusted, false);
  assert.equal(probation.adjustmentImpact, 0);
});

test('staff hub RTB score returns a simple coaching focus', () => {
  const score = buildRtbScore({
    latestEntry: { net_sales: 650 },
    ownPerformance: {
      avg_weekly_net: 600,
      best_week_net: 900,
      total_net_sales: 2400,
      total_tips: 180,
      under_minimum_weeks: 1,
      weeks_recorded: 4,
    },
    rank: 3,
  });

  assert.ok(score.score > 0);
  assert.equal(score.components.length, 4);
  assert.match(score.focus, /Focus this week/);
});
