export function validateSavedOperationItem(result, itemId, status) {
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
