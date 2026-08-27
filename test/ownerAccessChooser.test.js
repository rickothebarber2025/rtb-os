import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { getRoleTemplate } from '../src/lib/roleTemplates.js';

const chooser = fs.readFileSync(new URL('../src/components/RoleAccessChooser.jsx', import.meta.url), 'utf8');
const accessPage = fs.readFileSync(new URL('../src/pages/AccessPage.jsx', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

test('owner can choose module access before a promotion is saved', () => {
  assert.match(accessPage, /RoleAccessChooser/);
  assert.match(accessPage, /Promote \/ assign role/);
  assert.match(accessPage, /Apply role & access/);
  assert.match(accessPage, /Review promotion access before saving/);
});

test('access chooser exposes clear off, view, edit and admin states', () => {
  assert.match(chooser, /Not shared/);
  assert.match(chooser, /value="view"/);
  assert.match(chooser, /value="edit"/);
  assert.match(chooser, /value="admin"/);
  assert.match(chooser, /Sensitive/);
});

test('onboarding can define future access without granting it immediately', () => {
  assert.match(accessPage, /onboarding_target_permissions/);
  assert.match(accessPage, /After onboarding approval/);
  assert.match(accessPage, /Restricted now/);
  assert.match(accessPage, /Post-approval role/);
});

test('owner access is managed in AccessPage rather than a duplicate global modal', () => {
  assert.doesNotMatch(main, /OwnerRoleAccessSetup/);
  assert.match(main, /accessControl\.css/);
});

test('non-admin promotion templates keep sensitive modules off by default', () => {
  for (const id of ['beauty_manager', 'barbershop_manager', 'operations_assistant', 'appointment_coordinator', 'content_marketing', 'view_only']) {
    const template = getRoleTemplate(id);
    assert.equal(template.permissions.access, 'none', `${id} should not get Access by default`);
    assert.equal(template.permissions.payroll, 'none', `${id} should not get Payroll by default`);
    assert.equal(template.permissions.settings, 'none', `${id} should not get Settings by default`);
  }
});
