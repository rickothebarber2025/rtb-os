import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('app shell exposes skip navigation, focusable main content, and route announcements', () => {
  const shell = fs.readFileSync(new URL('../src/components/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /AccessibilityRuntime/);
  assert.match(shell, /className="skip-link"/);
  assert.match(shell, /href="#main-content"/);
  assert.match(shell, /id="main-content"/);
  assert.match(shell, /tabIndex=\{-1\}/);
});

test('topbar icon controls have accessible names', () => {
  const topbar = fs.readFileSync(new URL('../src/components/Topbar.jsx', import.meta.url), 'utf8');
  assert.match(topbar, /aria-label="Open navigation menu"/);
  assert.match(topbar, /aria-label="Refresh data"/);
  assert.match(topbar, /aria-label="Sign out"/);
  assert.match(topbar, /Signed in as/);
});

test('human experience layer protects keyboard focus and touch targets', () => {
  const css = fs.readFileSync(new URL('../src/styles/humanExperience.css', import.meta.url), 'utf8');
  assert.match(css, /focus-visible/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /prefers-contrast: more/);
  assert.match(css, /forced-colors: active/);
});

test('glass and micro-animation layer respects reduced motion', () => {
  const css = fs.readFileSync(new URL('../src/styles/humanExperience.css', import.meta.url), 'utf8');
  assert.match(css, /backdrop-filter: blur/);
  assert.match(css, /next-action-breathe/);
  assert.match(css, /completion-pop/);
  assert.match(css, /motion-reduced/);
});

test('behavioral guidance has a semantic accessible label', () => {
  const cue = fs.readFileSync(new URL('../src/components/BehavioralMomentumBar.jsx', import.meta.url), 'utf8');
  assert.match(cue, /aria-label="Recommended next action"/);
  assert.match(cue, /aria-hidden="true"/);
});

test('human experience stylesheet is loaded after behavioral styling', () => {
  const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const behavioralIndex = main.indexOf("./styles/behavioralUX.css");
  const humanIndex = main.indexOf("./styles/humanExperience.css");
  assert.ok(behavioralIndex >= 0);
  assert.ok(humanIndex > behavioralIndex);
});
