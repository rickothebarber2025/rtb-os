import { supabase } from '../lib/supabaseClient';
import { validateSavedOperationItem } from './checklistValidation.js';

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

async function optionalCall(name, args = {}) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function getMyDailyOperations(businessUnitId) {
  // Operations Cleaning is a whole-RTB assignment. The backend returns a
  // synthetic combined checklist spanning every business in the contractor's
  // access scope. Other roles receive null here and continue through the
  // normal single-business operation flow below.
  const combined = await optionalCall('get_my_cleaning_operations_all_businesses');
  if (combined?.combined_businesses) return combined;

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

export async function claimMyOperationChecklist(businessUnitId, checklistType, scope = 'shared') {
  if (scope === 'cleaning') {
    const combinedRunId = await optionalCall('claim_my_cleaning_all_businesses');
    if (combinedRunId) return combinedRunId;
  }

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
