import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const permissions = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');
const constants = fs.readFileSync(new URL('../src/utils/constants.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/MessagesPage.jsx', import.meta.url), 'utf8');
const proxy = fs.readFileSync(new URL('../supabase/functions/textnow-messages/index.ts', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../services/textnow-github-worker/worker.py', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/textnow-sync.yml', import.meta.url), 'utf8');

test('Messages is a first-class permissioned RTB OS module', () => {
  assert.match(permissions, /'messages'/);
  assert.match(permissions, /messages: 'Messages'/);
  assert.match(permissions, /messages: 'messages'/);
  assert.match(constants, /id: 'messages', label: 'Messages'/);
  assert.match(app, /MessagesPage/);
  assert.match(app, /ModuleGate module="messages"/);
});

test('TextNow credentials never enter the frontend or Supabase edge proxy', () => {
  assert.doesNotMatch(page, /connect\.sid|TEXTNOW_CONNECT_SID|TEXTNOW_CSRF/);
  assert.doesNotMatch(constants, /connect\.sid|TEXTNOW_CONNECT_SID|TEXTNOW_CSRF/);
  assert.doesNotMatch(proxy, /TEXTNOW_CONNECT_SID|TEXTNOW_CSRF|RTB_TEXTNOW_BRIDGE_SECRET|TEXTNOW_BRIDGE_URL/);
});

test('Supabase proxy requires authenticated RTB OS access and uses synced storage', () => {
  assert.match(proxy, /admin\.auth\.getUser/);
  assert.match(proxy, /messagesLevel/);
  assert.match(proxy, /Messages access is not enabled/);
  assert.match(proxy, /textnow_messages/);
  assert.match(proxy, /textnow_outbox/);
  assert.match(proxy, /textnow_sync_state/);
  assert.match(proxy, /mode: "github-actions"/);
});

test('GitHub worker uses PyTextNow and server-side session cookies', () => {
  assert.match(worker, /import pytextnow/);
  assert.match(worker, /TEXTNOW_CONNECT_SID/);
  assert.match(worker, /TEXTNOW_CSRF/);
  assert.match(worker, /sid_cookie=TEXTNOW_CONNECT_SID/);
  assert.match(worker, /csrf_cookie=TEXTNOW_CSRF/);
  assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('GitHub Actions injects TextNow and Supabase secrets into the worker', () => {
  assert.match(workflow, /secrets\.TEXTNOW_USERNAME/);
  assert.match(workflow, /secrets\.TEXTNOW_CONNECT_SID/);
  assert.match(workflow, /secrets\.TEXTNOW_CSRF/);
  assert.match(workflow, /secrets\.SUPABASE_URL/);
  assert.match(workflow, /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /services\/textnow-github-worker\/worker\.py/);
});

test('message direction is normalized from PyTextNow numeric constants', () => {
  assert.match(worker, /SENT_MESSAGE_TYPE/);
  assert.match(worker, /RECEIVED_MESSAGE_TYPE/);
  assert.match(worker, /direction = "outgoing"/);
  assert.match(worker, /direction = "incoming"/);
});
