import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HALEIGH_CLEANER_PERMISSIONS,
  HALEIGH_OPENING_CHECKLIST,
  HALEIGH_SHIFT,
  STAFF_CLOSING_CHECKLIST,
  canAccessCleanerFeature,
  validateStationInspection,
} from '../src/config/haleighCleanerWorkflow.js';

test('Haleigh shift uses the Toronto timezone and expected hours', () => {
  assert.equal(HALEIGH_SHIFT.start, '08:00');
  assert.equal(HALEIGH_SHIFT.end, '10:00');
  assert.equal(HALEIGH_SHIFT.timezone, 'America/Toronto');
});

test('cleaner role permits operations but denies financial access', () => {
  assert.equal(canAccessCleanerFeature('opening_checklist'), true);
  assert.equal(canAccessCleanerFeature('closing_inspection'), true);
  assert.equal(canAccessCleanerFeature('payroll'), false);
  assert.equal(canAccessCleanerFeature('bookings'), false);
  assert.ok(HALEIGH_CLEANER_PERMISSIONS.allow.length > 0);
  assert.ok(HALEIGH_CLEANER_PERMISSIONS.deny.length > 0);
});

test('opening checklist includes a photo-required final walkthrough', () => {
  const finalWalkthrough = HALEIGH_OPENING_CHECKLIST.find(
    (section) => section.section === 'Final walkthrough',
  );

  assert.ok(finalWalkthrough);
  assert.equal(finalWalkthrough.requiresPhoto, true);
  assert.ok(finalWalkthrough.tasks.includes('Upload final walkthrough photo'));
});

test('staff remain responsible for their own stations', () => {
  assert.ok(STAFF_CLOSING_CHECKLIST.includes('Take own garbage'));
  assert.ok(STAFF_CLOSING_CHECKLIST.includes('Put tools away'));
  assert.ok(STAFF_CLOSING_CHECKLIST.includes('Clean and sanitize station'));
});

test('failed station inspection requires staff, photo, and note', () => {
  assert.throws(
    () => validateStationInspection({ status: 'failed' }),
    /responsible staff member/,
  );

  assert.throws(
    () => validateStationInspection({ status: 'failed', responsibleStaffId: 'staff-1' }),
    /photo evidence/,
  );

  assert.throws(
    () => validateStationInspection({
      status: 'failed',
      responsibleStaffId: 'staff-1',
      photoUrl: 'https://example.com/photo.jpg',
    }),
    /written note/,
  );

  assert.equal(validateStationInspection({
    status: 'failed',
    responsibleStaffId: 'staff-1',
    photoUrl: 'https://example.com/photo.jpg',
    note: 'Station was left with hair and garbage.',
  }), true);
});

test('passed inspection does not require failure evidence', () => {
  assert.equal(validateStationInspection({ status: 'passed' }), true);
});
