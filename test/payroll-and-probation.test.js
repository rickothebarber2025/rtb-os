import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEntryValues, calculateRunTotals } from '../src/utils/payroll.js';
import { buildOperationalChecks, daysSince } from '../src/utils/operations.js';
import {
  getProbationInfo,
  toGraduationPayload,
  toProbationPayload,
} from '../src/utils/probation.js';

test('commission drops to 55% below $500 for non-fixed staff', () => {
  const result = calculateEntryValues({
    baseCommissionRate: 60,
    fixedRate: false,
    netSales: 400,
    tips: 20,
  });

  assert.equal(result.adjusted, true);
  assert.equal(result.appliedCommissionRate, 55);
  assert.equal(result.deduction, 5);
  assert.equal(result.takeHome, 235);
});

test('fixed-rate staff never auto-adjust', () => {
  const result = calculateEntryValues({
    baseCommissionRate: 65,
    fixedRate: true,
    netSales: 250,
    tips: 0,
  });

  assert.equal(result.adjusted, false);
  assert.equal(result.appliedCommissionRate, 65);
  assert.equal(result.takeHome, 157.5);
});

test('empty payroll entries never create negative payout or phantom deductions', () => {
  const entry = calculateEntryValues({
    baseCommissionRate: 60,
    fixedRate: false,
    netSales: 0,
    tips: 0,
  });
  const totals = calculateRunTotals({
    entries: [
      {
        applied_commission_rate: entry.appliedCommissionRate,
        deduction: entry.deduction,
        net_sales: 0,
        take_home: entry.takeHome,
      },
    ],
    ownerNetSales: 0,
  });

  assert.equal(entry.deduction, 0);
  assert.equal(entry.takeHome, 0);
  assert.equal(totals.totalDeductions, 0);
  assert.equal(totals.totalStaffPayout, 0);
  assert.equal(totals.rtbNet, 0);
});

test('probation uses its own start date and preserves employment start', () => {
  const staff = {
    active: true,
    full_name: 'Test Staff',
    start_date: '2025-01-15',
    tier: 'standard',
  };
  const probation = toProbationPayload(staff, '2026-06-01');
  const info = getProbationInfo(probation, new Date(2026, 6, 1));
  const graduated = toGraduationPayload(probation, new Date(2026, 6, 1));

  assert.equal(probation.start_date, '2025-01-15');
  assert.equal(probation.probation_start_date, '2026-06-01');
  assert.equal(info.endDateKey, '2026-08-30');
  assert.equal(graduated.tier, 'standard');
  assert.equal(graduated.commission_rate, 60);
  assert.match(graduated.notes, /Graduated from probation on 2026-07-01/);
});

test('operational checks flag stale payroll and disconnected Square', () => {
  const now = new Date('2026-06-19T12:00:00Z');
  const checks = buildOperationalChecks({
    activeStaffCount: 4,
    appointmentUpdatedAt: null,
    boothRentCount: 0,
    businessUnitName: 'RTB Beauty Lounge',
    latestRun: { week_end: '2026-06-07', week_label: 'Jun 1 - Jun 7' },
    payrollAllowed: true,
    squareStatus: { connected: false },
    now,
  });

  assert.equal(daysSince('2026-06-07', now), 12);
  assert.equal(checks.find((check) => check.label === 'Payroll').tone, 'warning');
  assert.equal(checks.find((check) => check.label === 'Square Appointments').tone, 'danger');
});
