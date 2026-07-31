import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPermissionsFromTemplate,
  getRoleTemplate,
  getTemplateRoleValue,
  ROLE_TEMPLATES,
} from '../src/lib/roleTemplates.js';

test('Operations Cleaning appears in the Access role template list', () => {
  const template = ROLE_TEMPLATES.find((item) => item.id === 'operations_cleaning');
  assert.ok(template);
  assert.equal(template.title, 'Operations Cleaning');
  assert.equal(getTemplateRoleValue(template.id), 'contractor');
});

test('Operations Cleaning only exposes Staff Hub and Operations', () => {
  const payload = buildPermissionsFromTemplate('operations_cleaning');

  assert.equal(payload.modules.staff_hub, 'view');
  assert.equal(payload.modules.operations, 'edit');
  assert.equal(payload.modules.payroll, 'none');
  assert.equal(payload.modules.appointments, 'none');
  assert.equal(payload.modules.roster, 'none');
  assert.equal(payload.modules.performance, 'none');
  assert.equal(payload.modules.booth_rent, 'none');
  assert.equal(payload.modules.access, 'none');
  assert.equal(payload.modules.settings, 'none');
});

test('Operations Cleaning includes required cleaning expectations', () => {
  const template = getRoleTemplate('operations_cleaning');
  assert.match(template.expectations, /8:00 AM–10:00 AM/);
  assert.ok(template.responsibilities.some((item) => /final walkthrough photo/i.test(item)));
  assert.ok(template.restrictions.some((item) => /No payroll/i.test(item)));
});
