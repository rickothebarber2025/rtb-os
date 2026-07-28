import { supabase } from '../lib/supabaseClient';

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
}

async function call(name, args) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
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

export function setMyOperationItem(itemId, status, { note = '', photoUrl = '' } = {}) {
  return call('set_my_operation_item', {
    p_item_id: itemId,
    p_status: status,
    p_note: note || null,
    p_photo_url: photoUrl || null,
  });
}

export function confirmMyOperationShift(businessUnitId, checklistType) {
  return call('confirm_operation_shift', {
    p_business_unit_id: businessUnitId || null,
    p_checklist_type: checklistType,
  });
}
