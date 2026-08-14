import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard = fs.readFileSync(new URL('../src/pages/DashboardPage.jsx', import.meta.url), 'utf8');
const enhancer = fs.readFileSync(new URL('../src/components/MobileNavigationEnhancer.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles/mobileNavigation.css', import.meta.url), 'utf8');

test('mobile dashboard tabs are dynamic instead of fixed', () => {
  assert.match(dashboard, /tabs = \[\{ id: 'overview', label: 'Overview' \}\]/);
  assert.match(dashboard, /actionSummary\.total > 0/);
  assert.match(dashboard, /hasAppointmentData/);
  assert.match(dashboard, /hasTeamData/);
  assert.match(dashboard, /payrollAllowed/);
  assert.doesNotMatch(dashboard, /\{ id: 'operations', label: 'Operations' \}/);
  assert.doesNotMatch(dashboard, /\{ id: 'payroll', label: 'Payroll' \}/);
});

test('appointments have a dedicated mobile destination and metrics', () => {
  assert.match(dashboard, /id: 'appointments', label: 'Appointments'/);
  assert.match(dashboard, /Booking activity/);
  assert.match(dashboard, /label="Bookings"/);
  assert.match(dashboard, /label="Revenue"/);
  assert.match(dashboard, /label="Clients"/);
  assert.match(dashboard, /label="No-shows"/);
});

test('performance and roster are grouped under Team while payroll stays Finance', () => {
  assert.match(dashboard, /panelAccessibility\('team', 'team-performance'\)/);
  assert.match(dashboard, /panelAccessibility\('team', 'team-roster'\)/);
  assert.match(dashboard, /panelAccessibility\('finance', 'finance'\)/);
});

test('dashboard tabs expose accessible tab semantics and keyboard navigation', () => {
  assert.match(dashboard, /role="tablist"/);
  assert.match(dashboard, /role="tab"/);
  assert.match(dashboard, /aria-selected=/);
  assert.match(dashboard, /aria-controls=/);
  assert.match(dashboard, /tabIndex=\{mobileTab === tab\.id \? 0 : -1\}/);
  assert.match(dashboard, /ArrowRight/);
  assert.match(dashboard, /ArrowLeft/);
  assert.match(dashboard, /Home/);
  assert.match(dashboard, /End/);
  assert.match(dashboard, /role: 'tabpanel'/);
});

test('dashboard tab state deep-links through the section query parameter', () => {
  assert.match(dashboard, /searchParams\.get\('section'\)/);
  assert.match(dashboard, /searchParams\.set\('section', id\)/);
  assert.match(dashboard, /popstate/);
  assert.match(dashboard, /pushState/);
});

test('Actions tab has live count badge and mobile tab changes scroll navigation into view', () => {
  assert.match(dashboard, /mobile-nav-count/);
  assert.match(dashboard, /open items/);
  assert.match(dashboard, /scrollIntoView/);
  assert.match(dashboard, /max-width: 900px/);
});

test('legacy dashboard enhancer leaves React-managed tabs alone', () => {
  assert.match(dashboard, /data-managed="react"/);
  assert.match(enhancer, /originalNav\.dataset\.managed === 'react'/);
});

test('mobile hides inactive groups without changing desktop rendering', () => {
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\[data-mobile-group\]:not\(\.is-active-mobile-tab\)/);
  assert.match(css, /display: none !important/);
});
