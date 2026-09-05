import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('RTB OS defaults to compact shop app density', () => {
  const preferences = fs.readFileSync(new URL('../src/hooks/useUserPreferences.js', import.meta.url), 'utf8');
  const shell = fs.readFileSync(new URL('../src/components/AppShell.jsx', import.meta.url), 'utf8');

  assert.match(preferences, /density: 'compact'/);
  assert.match(shell, /density-compact/);
});

test('shop app mode reduces website-style hero and insight overload', () => {
  const css = fs.readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const auth = fs.readFileSync(new URL('../src/pages/AuthPage.jsx', import.meta.url), 'utf8');

  assert.match(css, /RTB OS shop-app mode/);
  assert.match(css, /\.app-ambient,\n\.hero-panel::after,\n\.sidebar::before \{\n  display: none;/);
  assert.match(css, /\.staff-hub-pro-section-heading,[^}]+display: none;/);
  assert.match(css, /\.daily-ops-hero \{\n  display: none;/);
  assert.match(css, /\.topbar \{\n    display: none;/);
  assert.match(auth, /Shop Console/);
  assert.doesNotMatch(auth, /Business command center/);
});
