import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getNextBestChecklistItem,
  getSmartBusinessUnitId,
  getSmartCategoryExpansion,
  getSmartChecklistType,
  getSmartLandingPage,
  getSmartStaffHubTab,
} from '../src/utils/smartDefaults.js';

function profile(roleTemplate, overrides = {}) {
  return {
    active: true,
    role: roleTemplate === 'operations_cleaning' ? 'contractor' : 'staff',
    permissions: {
      business_scope: 'selected',
      business_unit_ids: ['beauty'],
      modules: { staff_hub: 'view' },
      role_template: roleTemplate,
      role_title: roleTemplate,
      ...overrides.permissions,
    },
    ...overrides,
  };
}

test('Operations Cleaning ignores stale single-business choice and defaults to Whole RTB', () => {
  const cleaner = profile('operations_cleaning', {
    permissions: {
      business_scope: 'all',
      business_unit_ids: ['all-businesses'],
      modules: { staff_hub: 'view' },
      role_template: 'operations_cleaning',
      role_title: 'Operations Cleaning',
    },
  });
  const options = [
    { id: 'all-businesses' },
    { id: 'lounge' },
    { id: 'beauty' },
  ];

  assert.equal(
    getSmartBusinessUnitId({ businessOptions: options, profile: cleaner, storedBusinessUnitId: 'beauty' }),
    'all-businesses',
  );
});

test('role-specific Staff Hub beats stale navigation history', () => {
  const navItems = [{ id: 'staff-hub' }];
  assert.equal(
    getSmartLandingPage({
      navItems,
      profile: profile('operations_cleaning'),
      recentPage: 'dashboard',
    }),
    'staff-hub',
  );
});

test('urgent operational work beats recent owner context', () => {
  const owner = profile('owner', {
    email: 'rickothebarber@gmail.com',
    role: 'owner',
    permissions: {
      business_scope: 'all',
      business_unit_ids: ['all-businesses'],
      modules: { dashboard: 'admin', operations: 'admin', payroll: 'admin' },
      role_template: 'owner',
      role_title: 'Owner',
    },
  });
  const navItems = [{ id: 'dashboard' }, { id: 'action-center' }, { id: 'payroll' }];

  assert.equal(
    getSmartLandingPage({
      navItems,
      profile: owner,
      recentPage: 'dashboard',
      signals: { urgentActionCount: 2, draftPayrollCount: 1 },
    }),
    'action-center',
  );
});

test('unfinished checklist resumes before time-of-day default', () => {
  const afterClosingTime = new Date('2026-08-12T19:00:00');
  assert.equal(
    getSmartChecklistType({
      now: afterClosingTime,
      runs: [
        {
          type: 'opening',
          completion_percent: 60,
          final_confirmed_at: null,
          started_at: '2026-08-12T10:00:00',
        },
      ],
    }),
    'opening',
  );
});

test('Staff Hub resumes Daily Ops when today has unfinished work', () => {
  assert.equal(
    getSmartStaffHubTab({
      profile: profile('staff_portal'),
      now: new Date('2026-08-12T13:00:00'),
      staffHub: {
        checklistRuns: [{ run_date: '2026-08-12', completion_percent: 40 }],
        tasks: [],
      },
    }),
    'daily',
  );
});

test('only the next incomplete category opens by default', () => {
  const expansion = getSmartCategoryExpansion([
    { category: 'Reception', status: 'completed' },
    { category: 'Washroom', status: 'pending' },
    { category: 'Inventory', status: 'pending' },
  ]);
  assert.deepEqual(expansion, { Reception: false, Washroom: true, Inventory: false });
});

test('required pending task is the next-best action', () => {
  const item = getNextBestChecklistItem([
    { id: 'optional', required: false, status: 'pending' },
    { id: 'required', required: true, status: 'pending' },
  ]);
  assert.equal(item.id, 'required');
});
