import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const permissions = fs.readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');
const constants = fs.readFileSync(new URL('../src/utils/constants.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/pages/MessagesPage.jsx', import.meta.url), 'utf8');
const proxy = fs.readFileSync(new URL('../supabase/functions/textnow-messages/index.ts', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../services/textnow-bridge/app.py', import.meta.url), 'utf8');

test('Messages is a first-class permissioned RTB OS module', () => {
  assert.match(permissions, /'messages'/);
  assert.match(permissions, /messages: 'Messages'/);
  assert.match(permissions, /messages: 'messages'/);
  assert.match(constants, /id: 'messages', label: 'Messages'/);
  assert.match(app, /MessagesPage/);
  assert.match(app, /ModuleGate module="messages"/);
});

test('TextNow credentials never enter the frontend', () => {
  assert.doesNotMatch(page, /connect\.sid|TEXTNOW_CONNECT_SID|TEXTNOW_CSRF/);
  assert.doesNotMatch(constants, /connect\.sid|TEXTNOW_CONNECT_SID|TEXTNOW_CSRF/);
  assert.match(proxy, /TEXTNOW_BRIDGE_URL/);
  assert.match(proxy, /RTB_TEXTNOW_BRIDGE_SECRET/);
});

test('Supabase proxy requires authenticated RTB OS access', () => {
  assert.match(proxy, /admin\.auth\.getUser/);
  assert.match(proxy, /messagesLevel/);
  assert.match(proxy, /Messages access is not enabled/);
});

test('Python bridge uses PyTextNow and server-side session cookies', () => {
  assert.match(bridge, /import pytextnow/);
  assert.match(bridge, /TEXTNOW_CONNECT_SID/);
  assert.match(bridge, /TEXTNOW_CSRF/);
  assert.match(bridge, /sid_cookie=SID, csrf_cookie=CSRF/);
  assert.match(bridge, /RTB_TEXTNOW_BRIDGE_SECRET/);
});

test('message direction is normalized from PyTextNow numeric constants', () => {
  assert.match(bridge, /SENT_MESSAGE_TYPE/);
  assert.match(bridge, /RECEIVED_MESSAGE_TYPE/);
  assert.match(bridge, /direction = "outgoing"/);
  assert.match(bridge, /direction = "incoming"/);
});
