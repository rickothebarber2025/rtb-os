import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildPermissionsFromTemplate } from '../src/lib/roleTemplates.js';
import { canAccessPage } from '../src/utils/access.js';
import { ALL_BUSINESSES_ID, getBusinessSelectionOptions } from '../src/utils/businessProfiles.js';

function profileFor(templateId, role, userType = 'employee', businessUnitIds = ['test-business']) {
  return {
    active: true,
    business_unit_id: businessUnitIds[0] || 'test-business',
    permissions: buildPermissionsFromTemplate(templateId, {
      business_scope: businessUnitIds.includes(ALL_BUSINESSES_ID) ? 'all' : 'selected',
      business_unit_ids: businessUnitIds,
    }),
    role,
    user_type: userType,
  };
}

const EMPLOYEE_OR_ADMIN_PAGES = [
  'dashboard',
  'payroll',
  'performance',
  'insights',
  'staff',
  'booth-rent',
  'operations',
  'access',
  'system',
  'my-role',
];

test('Operations Cleaning contractor is hub-only at page routing level', () => {
  const profile = profileFor('operations_cleaning', 'contractor', 'contractor');
  assert.equal(canAccessPage(profile, 'staff-hub'), true);
  for (const pageId of EMPLOYEE_OR_ADMIN_PAGES) {
    assert.equal(canAccessPage(profile, pageId), false, `${pageId} must remain blocked for Operations Cleaning`);
  }
});

test('Staff Portal remains hub-only at page routing level', () => {
  const profile = profileFor('staff_portal', 'staff');
  assert.equal(canAccessPage(profile, 'staff-hub'), true);
  for (const pageId of EMPLOYEE_OR_ADMIN_PAGES) {
    assert.equal(canAccessPage(profile, pageId), false, `${pageId} must remain blocked for Staff Portal`);
  }
});

test('contractor cleaning UI override stays loaded and hides employee metrics', () => {
  const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles/contractorCleaning.css', import.meta.url), 'utf8');

  assert.match(main, /contractorCleaning\.css/);
  assert.match(css, /staff-hub-ops-score-strip/);
  assert.match(css, /staff-hub-tabs-panel/);
  assert.match(css, /staff-hub-sticky-tabs/);
  assert.match(css, /staff-hub-money/);
  assert.match(css, /staff-hub-performance/);
  assert.match(css, /OPERATIONS CLEANING CONTRACTOR/);
});

test('Operations Cleaning template contains no financial, roster, appointment, admin, or standalone operations module access', () => {
  const modules = buildPermissionsFromTemplate('operations_cleaning').modules;
  const forbidden = ['payroll', 'performance', 'appointments', 'roster', 'access', 'settings', 'booth_rent', 'dashboard', 'operations'];
  for (const moduleId of forbidden) {
    assert.equal(modules[moduleId], 'none', `${moduleId} must remain none`);
  }
  assert.equal(modules.staff_hub, 'view');
});

test('mobile Staff Hub navigation has a dedicated Operations Cleaning branch', () => {
  const mobileTabBar = fs.readFileSync(new URL('../src/components/MobileTabBar.jsx', import.meta.url), 'utf8');
  const appShell = fs.readFileSync(new URL('../src/components/AppShell.jsx', import.meta.url), 'utf8');

  assert.match(mobileTabBar, /role_template === 'operations_cleaning'/);
  assert.match(mobileTabBar, /mobile-app-nav--cleaning/);
  assert.match(mobileTabBar, />Cleaning</);
  assert.match(mobileTabBar, /setStaffHubTab\('daily'\)/);
  assert.match(appShell, /profile=\{profile\}/);
});

test('Operations Cleaning with all-business access receives Whole RTB as the first scope', () => {
  const profile = profileFor('operations_cleaning', 'contractor', 'contractor', [ALL_BUSINESSES_ID]);
  const units = [
    { id: 'lounge', name: 'RTB Lounge' },
    { id: 'beauty', name: 'RTB Beauty Lounge' },
  ];
  const options = getBusinessSelectionOptions(units, profile);
  assert.equal(options[0].id, ALL_BUSINESSES_ID);
  assert.equal(options[0].name, 'Whole RTB');
  assert.equal(options.length, 3);
});

test('Operations Cleaning header locks to Whole RTB instead of a business chooser', () => {
  const topbar = fs.readFileSync(new URL('../src/components/Topbar.jsx', import.meta.url), 'utf8');
  const operationsService = fs.readFileSync(new URL('../src/services/staffOperationsService.js', import.meta.url), 'utf8');

  assert.match(topbar, /roleTemplate === 'operations_cleaning'/);
  assert.match(topbar, /setSelectedBusinessUnitId\(ALL_BUSINESSES_ID\)/);
  assert.match(topbar, /RTB Lounge \+ RTB Beauty Lounge/);
  assert.match(operationsService, /get_my_cleaning_operations_all_businesses/);
  assert.match(operationsService, /claim_my_cleaning_all_businesses/);
});
