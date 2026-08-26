import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildPermissionsFromTemplate, ROLE_TEMPLATES } from '../src/lib/roleTemplates.js';

const OPERATIONAL_TEMPLATE_IDS = ROLE_TEMPLATES
  .map((template) => template.id)
  .filter((id) => !['custom', 'owner', 'full_admin'].includes(id));

const NON_ADMIN_TEMPLATE_IDS = ROLE_TEMPLATES
  .map((template) => template.id)
  .filter((id) => !['owner', 'full_admin'].includes(id));

test('every operating role template keeps Staff Hub access', () => {
  for (const templateId of OPERATIONAL_TEMPLATE_IDS) {
    const modules = buildPermissionsFromTemplate(templateId).modules;
    assert.notEqual(modules.staff_hub, 'none', `${templateId} must keep Staff Hub access`);
  }
});

test('only owner and full admin templates receive Access admin by default', () => {
  for (const templateId of NON_ADMIN_TEMPLATE_IDS) {
    const modules = buildPermissionsFromTemplate(templateId).modules;
    assert.notEqual(modules.access, 'admin', `${templateId} must not silently receive Access admin`);
  }

  assert.equal(buildPermissionsFromTemplate('owner').modules.access, 'admin');
  assert.equal(buildPermissionsFromTemplate('full_admin').modules.access, 'admin');
});

test('sensitive admin permissions are not silently granted to ordinary staff roles', () => {
  const ordinary = ['staff_portal', 'payroll_assistant', 'operations_assistant', 'operations_cleaning', 'appointment_coordinator', 'content_marketing', 'view_only'];
  for (const templateId of ordinary) {
    const modules = buildPermissionsFromTemplate(templateId).modules;
    assert.notEqual(modules.payroll, 'admin', `${templateId} must not receive Payroll admin`);
    assert.notEqual(modules.settings, 'admin', `${templateId} must not receive Settings admin`);
    assert.notEqual(modules.access, 'admin', `${templateId} must not receive Access admin`);
  }
});

test('Operations Assistant defaults match the intended promotion baseline', () => {
  const modules = buildPermissionsFromTemplate('operations_assistant').modules;
  assert.equal(modules.staff_hub, 'view');
  assert.equal(modules.operations, 'edit');
  assert.equal(modules.dashboard, 'view');
  assert.equal(modules.roster, 'view');
  assert.equal(modules.performance, 'view');
  assert.equal(modules.payroll, 'none');
  assert.equal(modules.access, 'none');
});

test('owner access screen exposes human-friendly access controls and sensitive warnings', () => {
  const accessPage = fs.readFileSync(new URL('../src/pages/AccessPage.jsx', import.meta.url), 'utf8');
  const chooser = fs.readFileSync(new URL('../src/components/RoleAccessChooser.jsx', import.meta.url), 'utf8');

  assert.match(accessPage, /Promote \/ assign role/);
  assert.match(accessPage, /Review promotion access before saving/);
  assert.match(accessPage, /Apply role & access/);
  assert.match(chooser, /Choose exactly what they can access/);
  assert.match(chooser, /View —/);
  assert.match(chooser, /Edit —/);
  assert.match(chooser, /Admin —/);
  assert.match(chooser, /Sensitive/);
});
