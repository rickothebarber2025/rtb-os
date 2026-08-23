import { emitAccessChanged, emitDataChanged, emitNotificationChanged } from '../lib/appEvents';
import { supabase } from '../lib/supabaseClient';
import { getUserProfiles, updateUserProfile } from './rtbService';

function client() {
  if (!supabase) throw new Error('RTB OS is not connected to Supabase.');
  return supabase;
}

function dataOrThrow(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function listStaffWarnings({ businessUnitId = null, staffId = null } = {}) {
  let query = client()
    .from('staff_warnings')
    .select('*')
    .order('issued_at', { ascending: false })
    .limit(100);
  if (businessUnitId) query = query.eq('business_unit_id', businessUnitId);
  if (staffId) query = query.eq('staff_id', staffId);
  return dataOrThrow(await query) || [];
}

export async function issueStaffWarning(record) {
  const result = await client()
    .from('staff_warnings')
    .insert({
      business_unit_id: record.business_unit_id,
      category: record.category || 'general',
      details: record.details || null,
      level: Number(record.level || 1),
      metadata: record.metadata || {},
      staff_id: record.staff_id,
      title: record.title,
    })
    .select()
    .single();
  const warning = dataOrThrow(result);
  emitDataChanged('staff-warning-issued', { businessUnitId: warning.business_unit_id, staffId: warning.staff_id });
  emitNotificationChanged({ source: 'staff-warning-issued', staffId: warning.staff_id });
  return warning;
}

export async function acknowledgeMyStaffWarning(warningId) {
  const warning = dataOrThrow(await client().rpc('acknowledge_my_staff_warning', { p_warning_id: warningId }));
  emitDataChanged('staff-warning-acknowledged', { staffId: warning?.staff_id });
  emitNotificationChanged({ source: 'staff-warning-acknowledged', staffId: warning?.staff_id });
  return warning;
}

export async function updateStaffWarning(warningId, changes) {
  const payload = {
    resolution_note: changes.resolution_note || null,
    status: changes.status,
    updated_at: new Date().toISOString(),
  };
  const warning = dataOrThrow(
    await client().from('staff_warnings').update(payload).eq('id', warningId).select().single(),
  );
  emitDataChanged('staff-warning-updated', { businessUnitId: warning.business_unit_id, staffId: warning.staff_id });
  emitNotificationChanged({ source: 'staff-warning-updated', staffId: warning.staff_id });
  return warning;
}

export async function submitStaffTimeOffRequest(record) {
  const result = await client()
    .from('staff_time_off_requests')
    .insert({
      business_unit_id: record.business_unit_id,
      end_date: record.end_date,
      reason: record.reason || null,
      staff_id: record.staff_id,
      start_date: record.start_date,
      status: 'pending',
    })
    .select()
    .single();
  const request = dataOrThrow(result);
  emitDataChanged('time-off-requested', { businessUnitId: request.business_unit_id, staffId: request.staff_id });
  emitNotificationChanged({ source: 'time-off-requested', staffId: request.staff_id });
  return request;
}

export async function listMyTimeOffRequests(staffId) {
  if (!staffId) return [];
  return dataOrThrow(
    await client()
      .from('staff_time_off_requests')
      .select('*')
      .eq('staff_id', staffId)
      .order('created_at', { ascending: false })
      .limit(20),
  ) || [];
}

export async function listAccessProfiles() {
  return getUserProfiles();
}

export async function savePromotedAccess(profile) {
  const updated = await updateUserProfile(profile);
  emitAccessChanged(updated.id, { source: 'promotion-access-workspace' });
  emitDataChanged('promotion-access-saved', { userId: updated.id });
  return updated;
}
