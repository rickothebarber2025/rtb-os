import test from 'node:test';
import assert from 'node:assert/strict';

function validateSavedItem(result, itemId, status) {
  const expectedCompleted = status === true || status === 'completed';
  const expectedPending = status === false || status === 'pending';

  if (!result?.id || result.id !== itemId) {
    throw new Error('Checklist update was not confirmed by the database.');
  }
  if (expectedCompleted && result.completed !== true) {
    throw new Error('Checklist item did not save as completed.');
  }
  if (expectedPending && result.status !== 'pending') {
    throw new Error('Checklist item did not reopen correctly.');
  }
  if (!expectedPending && !result.completed_by_staff_id) {
    throw new Error('Checklist item saved without staff attribution.');
  }
  return result;
}

test('accepts a fully attributed completed checklist item', () => {
  const result = {
    id: 'item-1',
    status: 'completed',
    completed: true,
    completed_by_staff_id: 'staff-1',
  };
  assert.equal(validateSavedItem(result, 'item-1', 'completed'), result);
});

test('rejects a completed checklist item without attribution', () => {
  assert.throws(
    () => validateSavedItem({ id: 'item-1', status: 'completed', completed: true }, 'item-1', 'completed'),
    /without staff attribution/,
  );
});

test('rejects an RPC response that does not identify the saved item', () => {
  assert.throws(
    () => validateSavedItem({ run_id: 'run-1' }, 'item-1', 'completed'),
    /not confirmed by the database/,
  );
});

test('accepts reopening an item only when database returns pending', () => {
  const result = { id: 'item-1', status: 'pending', completed: false, completed_by_staff_id: null };
  assert.equal(validateSavedItem(result, 'item-1', 'pending'), result);
});

test('requires attribution for skipped and could-not-complete statuses', () => {
  assert.throws(
    () => validateSavedItem({ id: 'item-1', status: 'skipped', completed: false }, 'item-1', 'skipped'),
    /without staff attribution/,
  );
});
