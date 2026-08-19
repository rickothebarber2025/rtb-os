import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

function friendlyIntegrationError(error, data) {
  const serverMessage = data?.error || data?.message;
  if (serverMessage) return String(serverMessage);

  const message = String(error?.message || '').trim();
  if (/non-2xx/i.test(message)) {
    return 'RTB OS could not complete that integrations request. Refresh the page and try again.';
  }
  if (/failed to send|fetch/i.test(message)) {
    return 'RTB OS could not reach the integrations service. Check your connection and try again.';
  }
  return message || 'The integrations service is temporarily unavailable.';
}

async function callFunction(action, payload) {
  return supabase.functions.invoke('integration-manager', {
    body: { action, ...payload },
  });
}

async function invoke(action, payload = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('RTB OS connection services are not configured yet.');
  }

  let response = await callFunction(action, payload);

  // Mobile/PWA sessions can remain open while their JWT expires. The Edge Function
  // correctly requires a valid JWT, so refresh the Supabase session and retry once
  // instead of making the user reload/sign out manually.
  if (response.error) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed?.session?.access_token) {
      response = await callFunction(action, payload);
    }
  }

  const { data, error } = response;
  if (error) throw new Error(friendlyIntegrationError(error, data));
  if (data?.error) throw new Error(friendlyIntegrationError(null, data));
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
