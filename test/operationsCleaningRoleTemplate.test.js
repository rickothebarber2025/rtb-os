import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPermissionsFromTemplate,
  getRoleTemplate,
  getTemplateRoleValue,
  ROLE_TEMPLATES,
} from '../src/lib/roleTemplates.js';
import { buildRoleWorkspace } from '../src/utils/workspaces.js';

test('Operations Cleaning appears in the Access role template list', () => {
  const template = ROLE_TEMPLATES.find((item) => item.id === 'operations_cleaning');
  assert.ok(template);
  assert.equal(template.title, 'Operations Cleaning');
  assert.equal(getTemplateRoleValue(template.id), 'contractor');
});

test('Operations Cleaning exposes only its Staff Hub workspace', () => {
  const payload = buildPermissionsFromTemplate('operations_cleaning');

  assert.equal(payload.modules.staff_hub, 'view');
  for (const [moduleId, level] of Object.entries(payload.modules)) {
    if (moduleId === 'staff_hub') continue;
    assert.equal(level, 'none', `${moduleId} must stay hidden from Operations Cleaning contractors`);
  }
});

test('Operations Cleaning workspace cannot drift into employee or admin pages', () => {
  const payload = buildPermissionsFromTemplate('operations_cleaning', {
    business_unit_ids: ['beauty'],
  });
  const profile = {
    active: true,
    business_unit_id: 'beauty',
    permissions: payload,
    role: 'contractor',
    role_title: 'Operations Cleaning',
    user_type: 'contractor',
  };
  const navItems = [
    { id: 'staff-hub', label: 'Staff Hub' },
    { id: 'operations', label: 'Operations' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'performance', label: 'Performance' },
    { id: 'staff', label: 'Roster' },
    { id: 'insights', label: 'Appointments' },
    { id: 'my-role', label: 'My Role' },
  ];

  const workspace = buildRoleWorkspace(profile, navItems, { id: 'beauty', name: 'RTB Beauty Lounge' });
  assert.equal(workspace.title, 'Operations Cleaning Workspace');
  assert.deepEqual(workspace.focusPages.map((page) => page.id), ['staff-hub']);
  assert.deepEqual(workspace.editableModules, []);
  assert.deepEqual(workspace.visibleModules, ['Staff Hub']);
});

test('Operations Cleaning includes whole-shop cleaning expectations and explicit boundaries', () => {
  const template = getRoleTemplate('operations_cleaning');
  assert.match(template.expectations, /whole-shop cleaning and restocking/i);
  assert.ok(template.responsibilities.some((item) => /inventory/i.test(item)));
  assert.ok(template.responsibilities.some((item) => /final walkthrough photo/i.test(item)));
  assert.ok(template.restrictions.some((item) => /No payroll/i.test(item)));
  assert.ok(template.restrictions.some((item) => /No standalone Operations module/i.test(item)));
  assert.ok(template.restrictions.some((item) => /service-provider station/i.test(item)));
});
