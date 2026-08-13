import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildPermissionsFromTemplate } from '../src/lib/roleTemplates.js';
import { canAccessPage } from '../src/utils/access.js';

function profileFor(templateId, role, userType = 'employee') {
  return {
    active: true,
    business_unit_id: 'test-business',
    permissions: buildPermissionsFromTemplate(templateId, {
      business_unit_ids: ['test-business'],
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
