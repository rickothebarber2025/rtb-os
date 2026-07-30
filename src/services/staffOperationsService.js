import { supabase } from '../lib/supabaseClient';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function call(name, args) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  if (data === null || data === undefined) {
    throw new Error(`${name} did not return a saved result.`);
  }
  return data;
}

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

export function getMyDailyOperations(businessUnitId) {
  return call('get_my_daily_operations', { p_business_unit_id: businessUnitId || null });
}

export function startMyShift(businessUnitId, graceMinutes = 10) {
  return call('start_my_shift', {
    p_business_unit_id: businessUnitId || null,
    p_grace_minutes: graceMinutes,
  });
}

export function endMyShift(businessUnitId, afterHoursReason = '') {
  return call('end_my_shift', {
    p_business_unit_id: businessUnitId || null,
    p_after_hours_reason: afterHoursReason || null,
  });
}

export function claimMyOperationChecklist(businessUnitId, checklistType, scope = 'shared') {
  return call('claim_my_operation_checklist', {
    p_business_unit_id: businessUnitId || null,
    p_checklist_type: checklistType,
    p_scope: scope,
  });
}

export async function setMyOperationItem(itemId, status, { note = '', photoUrl = '' } = {}) {
  const result = await call('set_my_operation_item', {
    p_item_id: itemId,
    p_status: status,
    p_note: note || null,
    p_photo_url: photoUrl || null,
  });

  return validateSavedOperationItem(result, itemId, status);
}

export async function confirmMyOperationShift(businessUnitId, checklistType) {
  const result = await call('confirm_operation_shift', {
    p_business_unit_id: businessUnitId || null,
    p_checklist_type: checklistType,
  });

  if (result?.confirmed && (!result.run_id || !result.staff_id)) {
    throw new Error('Shift confirmation saved without a complete audit record.');
  }

  return result;
}
