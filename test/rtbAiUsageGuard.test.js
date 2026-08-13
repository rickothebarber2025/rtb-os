import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('RTB AI does not auto-generate a brief on component mount', () => {
  const source = fs.readFileSync(new URL('../src/components/GeminiOpsBrief.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /useEffect\s*\([^]*loadBrief\(/);
  assert.match(source, /\[expanded, setExpanded\] = useState\(false\)/);
  assert.match(source, /action: 'cached'/);
  assert.match(source, /RTB AI does not run in the background/);
});

test('RTB AI backend uses lean context and server-side summary caching', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/rtb-gemini/index.ts', import.meta.url), 'utf8');
  assert.match(source, /SUMMARY_CACHE_MS/);
  assert.match(source, /gatherLeanContext/);
  assert.match(source, /attendance_last_7_days/);
  assert.match(source, /maxOutputTokens: 500/);
  assert.doesNotMatch(source, /30 \* 86400000/);
});

test('normal AI questions do not run safe automations as a side effect', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/rtb-gemini/index.ts', import.meta.url), 'utf8');
  const automationCalls = source.match(/run_rtb_safe_automations/g) || [];
  assert.equal(automationCalls.length, 1);
  assert.match(source, /if \(action === "automation"\)/);
});

test('financial AI context is loaded only for explicit financial questions', () => {
  const source = fs.readFileSync(new URL('../supabase/functions/rtb-gemini/index.ts', import.meta.url), 'utf8');
  assert.match(source, /questionNeedsFinancialData/);
  assert.match(source, /action === "ask"/);
});
