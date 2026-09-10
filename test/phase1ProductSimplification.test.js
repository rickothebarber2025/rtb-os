import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { buildPermissionsFromTemplate } from '../src/lib/roleTemplates.js';
import { getAllowedNavItems } from '../src/utils/access.js';
import { ALL_BUSINESSES_ID, getBusinessSelectionOptions } from '../src/utils/businessProfiles.js';

function profileFor(templateId, role = 'staff', businessUnitIds = ['lounge']) {
  return {
    active: true,
    business_unit_id: businessUnitIds[0] === ALL_BUSINESSES_ID ? 'lounge' : businessUnitIds[0],
    email: templateId === 'owner' ? 'rickothebarber@gmail.com' : `${templateId}@rtb.test`,
    permissions: buildPermissionsFromTemplate(templateId, {
      business_scope: businessUnitIds.includes(ALL_BUSINESSES_ID) ? 'all' : 'selected',
      business_unit_ids: businessUnitIds,
    }),
    role,
  };
}

test('owner navigation is grouped around operating domains instead of old silos', () => {
  const nav = getAllowedNavItems(profileFor('owner', 'owner', [ALL_BUSINESSES_ID]));
  const groups = new Set(nav.map((item) => item.group));

  for (const group of ['Today', 'Team & Pay', 'Team Comms', 'Daily Ops', 'Client Flow', 'Control Room']) {
    assert.equal(groups.has(group), true, `${group} should be visible for owner navigation`);
  }

  for (const retiredGroup of ['Workspace', 'Operations', 'Intelligence', 'Admin', 'Administration']) {
    assert.equal(groups.has(retiredGroup), false, `${retiredGroup} should not return as a top-level sidebar silo`);
  }

  assert.equal(nav.find((item) => item.id === 'dashboard')?.label, 'Command Center');
  assert.equal(nav.find((item) => item.id === 'staff')?.group, 'Team & Pay');
  assert.equal(nav.find((item) => item.id === 'payroll')?.group, 'Team & Pay');
  assert.equal(nav.find((item) => item.id === 'staff-hub')?.label, 'Staff Messages');
});

test('owner sidebar condenses low-frequency tools behind More tools', () => {
  const sidebar = fs.readFileSync(new URL('../src/components/Sidebar.jsx', import.meta.url), 'utf8');
  assert.match(sidebar, /PRIMARY_NAV_IDS/);
  assert.match(sidebar, /More tools/);
  assert.match(sidebar, /secondaryItems/);
  assert.match(sidebar, /activeInSecondary/);
});

test('staff portal navigation stays simple and hub-only', () => {
  const nav = getAllowedNavItems(profileFor('staff_portal'));
  assert.deepEqual(nav.map((item) => item.id), ['staff-hub']);
  assert.equal(nav[0].group, 'Home');
  assert.equal(nav[0].label, 'Home');
});

test('payroll assistant sees team and pay without administration clutter', () => {
  const nav = getAllowedNavItems(profileFor('payroll_assistant'));
  const ids = nav.map((item) => item.id);
  assert.equal(ids.includes('payroll'), true);
  assert.equal(ids.includes('staff'), true);
  assert.equal(ids.includes('performance'), true);
  assert.equal(ids.includes('access'), false);
  assert.equal(nav.find((item) => item.id === 'payroll')?.group, 'Team & Pay');
});

test('single-business users do not receive Whole RTB as a selectable scope', () => {
  const units = [
    { id: 'lounge', name: 'RTB Lounge' },
    { id: 'beauty', name: 'RTB Beauty Lounge' },
  ];
  const options = getBusinessSelectionOptions(units, profileFor('barbershop_manager', 'manager', ['lounge']));
  assert.deepEqual(options.map((option) => option.id), ['lounge']);
});

test('staff announcements have creator attribution, edit, and archive lifecycle wiring', () => {
  const service = fs.readFileSync(new URL('../src/services/rtbService.js', import.meta.url), 'utf8');
  const hub = fs.readFileSync(new URL('../src/pages/StaffHubPage.jsx', import.meta.url), 'utf8');
  const messageCenter = fs.readFileSync(new URL('../src/components/StaffMessageCenter.jsx', import.meta.url), 'utf8');
  const migration = fs.readFileSync(
    new URL('../supabase/migrations/20260909222806_phase1_staff_announcement_archive_actor.sql', import.meta.url),
    'utf8',
  );

  assert.match(service, /archiveStaffAnnouncement/);
  assert.match(service, /created_by: record\.id \? undefined : record\.created_by/);
  assert.match(service, /\.is\('archived_at', null\)/);
  assert.match(hub, /canManageAnnouncement/);
  assert.match(hub, /Posted by you/);
  assert.match(hub, /Archive/);
  assert.match(messageCenter, /\.is\('archived_at', null\)/);
  assert.match(migration, /archived_at timestamptz/);
  assert.match(migration, /archived_by uuid references auth\.users/);
  assert.match(migration, /created_by = \(select auth\.uid\(\)\)/);
});

test('Staff Hub home prioritizes daily action cards before communication', () => {
  const hub = fs.readFileSync(new URL('../src/pages/StaffHubPage.jsx', import.meta.url), 'utf8');
  assert.ok(
    hub.indexOf('staff-hub-focus-band') < hub.indexOf('staff-hub-communication-zone'),
    'focus band should render before communication on the Staff Hub home tab',
  );
  assert.ok(
    hub.indexOf('staff-hub-dashboard-grid') < hub.indexOf('staff-hub-communication-zone'),
    'daily dashboard should render before communication on the Staff Hub home tab',
  );
  assert.match(hub, /staff-hub-secondary-card/);
  assert.doesNotMatch(hub.slice(hub.indexOf("activeTab === 'home'"), hub.indexOf("activeTab === 'updates'")), /Message management/);
});

test('mobile shell limits role quick navigation and uses a dialog notification drawer', () => {
  const mobile = fs.readFileSync(new URL('../src/components/MobileTabBar.jsx', import.meta.url), 'utf8');
  const notifications = fs.readFileSync(new URL('../src/components/StaffNotifications.jsx', import.meta.url), 'utf8');

  assert.match(mobile, /OWNER_QUICK_NAV_IDS = \['dashboard', 'action-center', 'staff', 'payroll'\]/);
  assert.match(mobile, /PAYROLL_QUICK_NAV_IDS = \['dashboard', 'payroll', 'staff', 'performance'\]/);
  assert.match(mobile, /STAFF_QUICK_NAV_IDS = \['staff-hub'\]/);
  assert.match(notifications, /role="dialog"/);
  assert.match(notifications, /aria-modal="true"/);
});
