import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const hub = fs.readFileSync(new URL('../src/pages/StaffHubPage.jsx', import.meta.url), 'utf8');
const push = fs.readFileSync(new URL('../src/components/PushNotificationsManager.jsx', import.meta.url), 'utf8');
const notifications = fs.readFileSync(new URL('../src/components/StaffNotifications.jsx', import.meta.url), 'utf8');

test('Staff Hub navigation is owned by React without the legacy DOM rewriter', () => {
  assert.doesNotMatch(main, /StaffHubNavigationEnhancer/);
});

test('legacy and backend tab names resolve to live Staff Hub panels', () => {
  assert.match(hub, /growth: 'stats'/);
  assert.match(hub, /performance: 'stats'/);
  assert.match(hub, /team: 'more'/);
  assert.match(hub, /VALID_STAFF_HUB_TABS\.has\(normalized\) \? normalized : 'home'/);
});

test('performance notifications open the Stats panel', () => {
  assert.match(push, /route === 'performance'.+tab: 'stats'/s);
  assert.match(notifications, /performance\|coaching\|goal.+tab: 'stats'/s);
  assert.doesNotMatch(push, /tab: 'performance'/);
  assert.doesNotMatch(notifications, /tab: 'performance'/);
});
