import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge = fs.readFileSync(new URL('../src/native/googleHomeBridge.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/components/AdminChecklistDashboard.jsx', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/rtbService.js', import.meta.url), 'utf8');
const appProject = fs.readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
const renamedProject = fs.readFileSync(new URL('../ios/App/RTB OS.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
const entitlements = fs.readFileSync(new URL('../ios/App/App/App.entitlements', import.meta.url), 'utf8');

test('Google Home bridge stays guarded until native OAuth and SDK are configured', () => {
  assert.match(bridge, /registerPlugin\('GoogleHomeBridge'\)/);
  assert.match(bridge, /sdkAvailable/);
  assert.match(bridge, /clientIDConfigured/);
  assert.match(bridge, /cloudProjectConfigured/);
  assert.match(bridge, /disconnectGoogleHome/);
  assert.match(dashboard, /disabled=\{connectingHome \|\| !bridgeReady \|\| bridgeStatus\?\.connected\}/);
});

test('Google Home authorization records an authenticated setup test event', () => {
  assert.match(service, /recordGoogleHomeSetupTestEvent/);
  assert.match(service, /invokeFunction\('google-home-shop-event'/);
  assert.match(service, /setup_test: true/);
  assert.match(dashboard, /recordGoogleHomeSetupTestEvent\(businessUnitId\)/);
  assert.match(dashboard, /a setup test event reached RTB OS/);
});

test('iOS Google Home requirements include App Attest and the shared app group', () => {
  assert.match(entitlements, /com\.apple\.developer\.devicecheck\.appattest-environment/);
  assert.match(entitlements, /group\.com\.rtbheadquaters\.os/);
  assert.match(dashboard, /disconnectHome/);
  assert.match(appProject, /APP_ATTEST_ENVIRONMENT = development/);
  assert.match(appProject, /APP_ATTEST_ENVIRONMENT = production/);
  assert.match(appProject, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements/);
  assert.match(renamedProject, /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements/);
});

test('native bridge restores sessions and passes the shared App Group to Google Home', () => {
  const appDelegate = fs.readFileSync(new URL('../ios/App/App/AppDelegate.swift', import.meta.url), 'utf8');
  assert.match(appDelegate, /sharedAppGroup = "group\.com\.rtbheadquaters\.os"/);
  assert.match(appDelegate, /\$0\.sharedAppGroup = sharedAppGroup/);
  assert.match(appDelegate, /Home\.restoreSession\(\)/);
  assert.match(appDelegate, /activeHome\?\.disconnect\(\)/);
});
