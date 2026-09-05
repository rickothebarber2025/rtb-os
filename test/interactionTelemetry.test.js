import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const telemetry = fs.readFileSync(new URL('../src/components/InteractionTelemetry.jsx', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../src/components/AppShell.jsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260905170000_add_anonymous_app_interaction_events.sql', import.meta.url),
  'utf8',
);
const agent = fs.readFileSync(new URL('../supabase/functions/rtb-gemini/index.ts', import.meta.url), 'utf8');

test('anonymous interaction learning excludes identity and sensitive content', () => {
  assert.match(telemetry, /app_interaction_events/);
  assert.doesNotMatch(telemetry, /user_id|email|customer|payroll|photo|message/);
  assert.match(telemetry, /navigation/);
  assert.match(telemetry, /repeated_navigation/);
  assert.match(telemetry, /form_abandoned/);
  assert.match(telemetry, /client_error/);
});

test('telemetry is mounted only for an active authenticated app user', () => {
  assert.match(shell, /<InteractionTelemetry/);
  assert.match(shell, /enabled=\{Boolean\(profile\?\.active && user\?\.id\)\}/);
});

test('interaction events are insert-only for authenticated clients', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.app_interaction_events from anon, authenticated/);
  assert.match(migration, /grant insert on table public\.app_interaction_events to authenticated/);
  assert.doesNotMatch(migration, /grant select on table public\.app_interaction_events to authenticated/);
});

test('RTB AI receives aggregate usability patterns only for the owner', () => {
  assert.match(agent, /includeUsability: owner/);
  assert.match(agent, /summarizeUsability/);
  assert.match(agent, /Treat usability patterns as directional evidence/);
  assert.doesNotMatch(agent, /\.select\("[^"]*user_id/);
});
