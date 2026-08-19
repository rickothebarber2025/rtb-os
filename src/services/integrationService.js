import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

async function invoke(action, payload = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase.functions.invoke('integration-manager', {
    body: { action, ...payload },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}

export async function listIntegrationConnections() {
  const result = await invoke('list');
  return Array.isArray(result.connections) ? result.connections : [];
}

export async function beginIntegrationConnection(provider, businessUnitId) {
  return invoke('begin_connect', { provider, businessUnitId: businessUnitId || null });
}

export async function saveIntegrationSetup(provider, businessUnitId, credentials) {
  return invoke('save_setup', {
    provider,
    businessUnitId: businessUnitId || null,
    credentials,
  });
}

export async function disconnectIntegration(provider, businessUnitId) {
  return invoke('disconnect', { provider, businessUnitId: businessUnitId || null });
}

export async function testIntegrationConnection(provider, businessUnitId) {
  return invoke('test', { provider, businessUnitId: businessUnitId || null });
}
