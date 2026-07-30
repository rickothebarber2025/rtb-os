import { supabase } from '../lib/supabaseClient';
import { validateStationInspection } from '../config/haleighCleanerWorkflow.js';

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

export function getMyCleanerDashboard(businessUnitId) {
  return call('get_my_cleaner_dashboard', {
    p_business_unit_id: businessUnitId || null,
  });
}

export function claimMyCleanerChecklist(businessUnitId) {
  return call('claim_my_cleaner_checklist', {
    p_business_unit_id: businessUnitId || null,
  });
}

export function setMyCleanerTask(itemId, status, { note = '', photoUrl = '' } = {}) {
  return call('set_my_operation_item', {
    p_item_id: itemId,
    p_status: status,
    p_note: note || null,
    p_photo_url: photoUrl || null,
  });
}

export async function markShopReady(businessUnitId, photoUrl) {
  if (!photoUrl) throw new Error('A final walkthrough photo is required.');

  const result = await call('mark_shop_ready', {
    p_business_unit_id: businessUnitId || null,
    p_photo_url: photoUrl,
  });

  if (!result?.ready || !result?.staff_id || !result?.ready_at) {
    throw new Error('Shop-ready confirmation was not saved with a complete audit record.');
  }

  return result;
}

export async function submitStationInspection(businessUnitId, inspection) {
  validateStationInspection(inspection);

  const result = await call('submit_station_inspection', {
    p_business_unit_id: businessUnitId || null,
    p_responsible_staff_id: inspection.responsibleStaffId || null,
    p_status: inspection.status,
    p_note: inspection.note || null,
    p_photo_url: inspection.photoUrl || null,
    p_station_label: inspection.stationLabel || null,
  });

  if (!result?.inspection_id || !result?.inspector_staff_id || !result?.created_at) {
    throw new Error('Station inspection was not saved with a complete audit record.');
  }

  return result;
}
