import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSavedOperationItem } from '../src/services/staffOperationsService.js';

test('accepts a fully attributed completed checklist item', () => {
  const result = {
    id: 'item-1',
    status: 'completed',
    completed: true,
    completed_by_staff_id: 'staff-1',
  };
  assert.equal(validateSavedOperationItem(result, 'item-1', 'completed'), result);
});

test('rejects a completed checklist item without attribution', () => {
  assert.throws(
    () => validateSavedOperationItem({ id: 'item-1', status: 'completed', completed: true }, 'item-1', 'completed'),
    /without staff attribution/,
  );
});

test('rejects an RPC response that does not identify the saved item', () => {
  assert.throws(
    () => validateSavedOperationItem({ run_id: 'run-1' }, 'item-1', 'completed'),
    /not confirmed by the database/,
  );
});

test('accepts reopening an item only when database returns pending', () => {
  const result = { id: 'item-1', status: 'pending', completed: false, completed_by_staff_id: null };
  assert.equal(validateSavedOperationItem(result, 'item-1', 'pending'), result);
});

test('requires attribution for skipped and could-not-complete statuses', () => {
  assert.throws(
    () => validateSavedOperationItem({ id: 'item-1', status: 'skipped', completed: false }, 'item-1', 'skipped'),
    /without staff attribution/,
  );
});
