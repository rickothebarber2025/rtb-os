import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const auditMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260912083000_harden_manager_activity_lifecycle.sql', import.meta.url),
  'utf8',
);
const roleTemplates = fs.readFileSync(new URL('../src/lib/roleTemplates.js', import.meta.url), 'utf8');
const staffExperience = fs.readFileSync(new URL('../src/services/staffExperienceService.js', import.meta.url), 'utf8');
const staffHub = fs.readFileSync(new URL('../src/pages/StaffHubPage.jsx', import.meta.url), 'utf8');

test('operations manager has operational authority but not owner financial/system authority', () => {
  assert.match(roleTemplates, /id: 'operations_manager'/);
  assert.match(roleTemplates, /operations: 'edit'/);
  assert.match(roleTemplates, /performance: 'edit'/);
  assert.match(roleTemplates, /roster: 'edit'/);
  assert.match(roleTemplates, /No payroll editing or payroll finalization/);
  assert.match(roleTemplates, /No user-access or permission administration/);
});

test('warnings verify persistence and refresh downstream state', () => {
  assert.match(staffExperience, /from\('staff_warnings'\)[\s\S]*insert\([\s\S]*select\(\)[\s\S]*single\(\)/);
  assert.match(staffExperience, /emitDataChanged\('staff-warning-issued'/);
  assert.match(staffExperience, /emitNotificationChanged\(\{ source: 'staff-warning-issued'/);
});

test('staff hub never reports success until the awaited action completes', () => {
  assert.match(staffHub, /const result = await action\(\);[\s\S]*setHubMessage\(successMessage\);/);
  assert.match(staffHub, /catch \(err\)[\s\S]*setHubError/);
});

test('manager audit records warning resolution and operational decisions', () => {
  assert.match(auditMigration, /warning_resolved/);
  assert.match(auditMigration, /warning_voided/);
  assert.match(auditMigration, /operations_request_status_changed/);
  assert.match(auditMigration, /time_off_approved/);
  assert.match(auditMigration, /time_off_denied/);
  assert.match(auditMigration, /checklist_approved/);
  assert.match(auditMigration, /shift_approved/);
});

test('manager activity is idempotent per persisted entity action', () => {
  assert.match(auditMigration, /create unique index if not exists manager_activity_unique_persisted_action_idx/);
});
