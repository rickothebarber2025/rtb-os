import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildBehavioralCue } from '../src/utils/behavioralUX.js';

const cleaner = {
  role: 'contractor',
  permissions: {
    role_template: 'operations_cleaning',
  },
};

test('reciprocity is the default Operations Cleaning cue', () => {
  const cue = buildBehavioralCue({
    activePage: 'staff-hub',
    profile: cleaner,
    signals: { unfinishedChecklistCount: 0 },
  });
  assert.equal(cue.principle, 'reciprocity');
  assert.equal(cue.targetTab, 'daily');
  assert.match(cue.description, /already matched|already/i);
});

test('Operations Cleaning with saved work emphasizes preservation before loss framing', () => {
  const cue = buildBehavioralCue({
    activePage: 'staff-hub',
    profile: cleaner,
    signals: { unfinishedChecklistCount: 2, urgentActionCount: 5 },
  });
  assert.equal(cue.principle, 'reciprocity');
  assert.match(cue.description, /saved progress/i);
});

test('loss aversion appears only when a real urgent signal exists', () => {
  const owner = { permissions: { role_template: 'owner' } };
  assert.equal(
    buildBehavioralCue({ activePage: 'dashboard', profile: owner, signals: { urgentActionCount: 0 } }),
    null,
  );

  const cue = buildBehavioralCue({
    activePage: 'dashboard',
    profile: owner,
    signals: { urgentActionCount: 2 },
  });
  assert.equal(cue.principle, 'loss-aversion');
  assert.match(cue.title, /2 priority items/);
});

test('saved payroll draft uses endowment framing', () => {
  const cue = buildBehavioralCue({
    activePage: 'dashboard',
    profile: { permissions: { role_template: 'owner' } },
    signals: { draftPayrollCount: 1 },
  });
  assert.equal(cue.principle, 'endowment');
  assert.match(cue.description, /already saved/i);
});

test('Figma-ready spec forbids fake scarcity and invented urgency', () => {
  const spec = fs.readFileSync(new URL('../docs/behavioral-ux-figma-spec.md', import.meta.url), 'utf8');
  assert.match(spec, /Reciprocity \/ value first/);
  assert.match(spec, /invented countdown timers/);
  assert.match(spec, /fabricated scarcity/);
  assert.match(spec, /Never manufacture progress/);
});

test('global behavioral layer is mounted in AppShell', () => {
  const shell = fs.readFileSync(new URL('../src/components/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /BehavioralMomentumBar/);
  assert.match(shell, /behavioralSignals/);
});
