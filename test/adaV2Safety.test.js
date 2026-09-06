import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Ada reports partial source failures instead of treating them as empty business data', async () => {
  const backend = await source('supabase/functions/ada-agent/index.ts');
  assert.match(backend, /source_status/);
  assert.match(backend, /unavailableSources/);
  assert.match(backend, /do not interpret missing rows as zero activity/i);
});

test('Ada owner copilot cannot directly invoke RTB automations', async () => {
  const backend = await source('supabase/functions/ada-agent/index.ts');
  assert.doesNotMatch(backend, /admin\.rpc\("run_rtb_safe_automations"\)/);
  assert.match(backend, /cannot execute RTB automations/);
});

test('Ada suggestions use the existing staff task lifecycle with an undo path', async () => {
  const component = await source('src/components/GeminiOpsBrief.jsx');
  assert.match(component, /saveStaffTask/);
  assert.match(component, /updateStaffTaskStatus\(created\.id, 'completed'\)/);
  assert.match(component, /Undo task/);
});

test('time-off decisions require confirmation and support reopening', async () => {
  const backend = await source('supabase/functions/ada-time-off/index.ts');
  const component = await source('src/components/AdaTimeOffReview.jsx');
  assert.match(backend, /body\.confirmed !== true/);
  assert.match(backend, /action === "reopen"/);
  assert.match(component, /Confirm .*approval/);
  assert.match(component, /undoDecision/);
});
