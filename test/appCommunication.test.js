import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appEvents = fs.readFileSync(new URL('../src/lib/appEvents.js', import.meta.url), 'utf8');
const liveRefresh = fs.readFileSync(new URL('../src/hooks/useLiveRefresh.js', import.meta.url), 'utf8');
const auth = fs.readFileSync(new URL('../src/hooks/useAuth.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const realtimeMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260822033500_enable_core_rtb_realtime.sql', import.meta.url),
  'utf8',
);

test('RTB OS has one central app event channel for cross-module communication', () => {
  assert.match(appEvents, /rtb-os-events-v1/);
  assert.match(appEvents, /BroadcastChannel/);
  assert.match(appEvents, /data\.changed/);
  assert.match(appEvents, /access\.changed/);
  assert.match(appEvents, /navigation\.request/);
  assert.match(appEvents, /notifications\.changed/);
});

test('live refresh reacts to app events and high-value realtime tables', () => {
  assert.match(liveRefresh, /onAppEvent/);
  for (const table of [
    'user_profiles',
    'staff',
    'staff_tasks',
    'staff_time_off_requests',
    'staff_shift_records',
    'staff_operations_requests',
    'operation_checklist_runs',
    'owner_activity_events',
    'payroll_runs',
    'integration_connections',
    'talent_candidates',
  ]) {
    assert.match(liveRefresh, new RegExp(table));
    assert.match(realtimeMigration, new RegExp(table));
  }
});

test('access updates can refresh active staff sessions without a new login', () => {
  assert.match(auth, /event\?\.type !== 'access\.changed'/);
  assert.match(auth, /refreshProfile\(\)/);
  assert.match(auth, /user-profile-access-/);
});

test('modules can request safe navigation through the app shell', () => {
  assert.match(app, /event\?\.type !== 'navigation\.request'/);
  assert.match(app, /canAccessPage\(auth\.profile, page\)/);
  assert.match(app, /setSelectedBusinessUnitId/);
  assert.match(app, /setPageTarget/);
});
