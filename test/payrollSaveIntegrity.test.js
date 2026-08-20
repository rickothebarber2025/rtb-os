import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEntryValues } from '../src/utils/payroll.js';

test('payroll recalculation preserves staff identity and entered amounts before save', () => {
  const input = {
    staff_id: '11111111-1111-1111-1111-111111111111',
    staff_name_snapshot: 'Josh',
    role_snapshot: 'Barber',
    tier_snapshot: 'standard',
    base_commission_rate: 60,
    fixed_rate_snapshot: false,
    net_sales: 1000,
    tips: 50,
    notes: 'weekly payroll',
  };

  const result = calculateEntryValues(input);

  assert.equal(result.staff_id, input.staff_id);
  assert.equal(result.staff_name_snapshot, 'Josh');
  assert.equal(result.net_sales, 1000);
  assert.equal(result.tips, 50);
  assert.equal(result.base_commission_rate, 60);
  assert.equal(result.applied_commission_rate, 60);
  assert.equal(result.take_home, 645);
  assert.equal(result.notes, 'weekly payroll');
});

test('payroll recalculation accepts both UI camelCase and saved snake_case fields', () => {
  const camel = calculateEntryValues({ baseCommissionRate: 60, fixedRate: false, netSales: 700, tips: 20 });
  const snake = calculateEntryValues({ base_commission_rate: 60, fixed_rate_snapshot: false, net_sales: 700, tips: 20 });

  assert.equal(camel.takeHome, snake.takeHome);
  assert.equal(camel.appliedCommissionRate, snake.appliedCommissionRate);
  assert.equal(snake.net_sales, 700);
});
