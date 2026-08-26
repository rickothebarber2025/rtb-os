import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('auth explicitly signals notification token sync when a session is ready', () => {
  const source = fs.readFileSync(new URL('../src/hooks/useAuth.js', import.meta.url), 'utf8');
  assert.match(source, /rtb:auth-session-ready/);
  assert.match(source, /notifySessionReady\(nextSession/);
});

test('non-owner users have an in-app notification center', () => {
  const topbar = fs.readFileSync(new URL('../src/components/Topbar.jsx', import.meta.url), 'utf8');
  const center = fs.readFileSync(new URL('../src/components/StaffNotifications.jsx', import.meta.url), 'utf8');
  assert.match(topbar, /StaffNotifications/);
  assert.match(center, /staff_operation_notifications/);
  assert.match(center, /rtb:notification-received/);
  assert.match(center, /postgres_changes/);
});

test('native push preserves Staff Hub route and tab across cold start', () => {
  const lib = fs.readFileSync(new URL('../src/lib/pushNotifications.js', import.meta.url), 'utf8');
  const manager = fs.readFileSync(new URL('../src/components/PushNotificationsManager.jsx', import.meta.url), 'utf8');
  assert.match(lib, /rtb-os-push-destination/);
  assert.match(lib, /pushNotificationActionPerformed/);
  assert.match(manager, /staff_hub_tab/);
  assert.match(manager, /rtb-os-push-destination/);
  assert.match(manager, /tab: 'stats'/);
  assert.doesNotMatch(manager, /tab: 'performance'/);
});

test('staff notifications bridge to push queue idempotently', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260814023000_unify_staff_notifications_and_push.sql', import.meta.url), 'utf8');
  assert.match(migration, /enqueue_staff_operation_notification_push/);
  assert.match(migration, /push_notification_queue/);
  assert.match(migration, /on conflict \(user_id, source_table, source_id, title\)/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.staff_operation_notifications/i);
});

test('meaningful staff events create notifications without notifying on every checklist click', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260814023000_unify_staff_notifications_and_push.sql', import.meta.url), 'utf8');
  assert.match(migration, /notify_staff_task_assignment/);
  assert.match(migration, /notify_staff_announcement/);
  assert.match(migration, /notify_staff_shop_status/);
  assert.doesNotMatch(migration, /create trigger .*operation_checklist_run_items[^]*staff_operation_notifications/i);
});

test('push dispatcher claims jobs before APNs send and retries cleanly', () => {
  const dispatcher = fs.readFileSync(new URL('../supabase/functions/push-dispatch/index.ts', import.meta.url), 'utf8');
  assert.match(dispatcher, /status: "processing"/);
  assert.match(dispatcher, /\.eq\("status", "pending"\)/);
  assert.match(dispatcher, /reviveStaleProcessingJobs/);
  assert.match(dispatcher, /status: exhausted \? "failed" : "pending"/);
  assert.match(dispatcher, /PUSH_DISPATCH_SECRET/);
  assert.match(dispatcher, /INVALID_TOKEN_REASONS/);
});

test('staff notification push payloads target real Staff Hub tab ids', () => {
  const original = fs.readFileSync(new URL('../supabase/migrations/20260814023000_unify_staff_notifications_and_push.sql', import.meta.url), 'utf8');
  const fix = fs.readFileSync(new URL('../supabase/migrations/20260826234137_normalize_staff_notification_tabs.sql', import.meta.url), 'utf8');
  assert.match(fix, /then 'stats'/);
  assert.match(fix, /data->>'tab' = 'performance'/);
  assert.match(original, /staff_hub_tab/);
});
