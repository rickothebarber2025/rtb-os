import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

function friendlyIntegrationError(error, data) {
  const code = String(data?.code || '').trim();
  if (code === 'AUTH_REQUIRED') return 'Your RTB OS session expired. Sign in again or refresh and retry.';
  if (code === 'OWNER_REQUIRED') return 'Owner access is required to manage integrations.';
  if (code === 'PROVIDER_REQUIRED') return 'Choose an integration and try again.';
  if (code === 'SETUP_REQUIRED') return 'Finish the one-time connection setup, then try again.';

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

function shouldRefreshSession(response) {
  if (response?.data?.code === 'AUTH_REQUIRED') return true;
  const message = String(response?.error?.message || '');
  return /401|jwt|unauthorized|authentication required/i.test(message);
}

async function invoke(action, payload = {}) {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('RTB OS connection services are not configured yet.');
  }

  let response = await callFunction(action, payload);

  // Mobile/PWA sessions can remain open while their JWT expires. Refresh only when
  // the server or Supabase gateway explicitly reports an authentication problem.
  if (shouldRefreshSession(response)) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError && refreshed?.session?.access_token) {
      response = await callFunction(action, payload);
    }
  }

  const { data, error } = response;
  if (error) throw new Error(friendlyIntegrationError(error, data));
  if (data?.ok === false || data?.error) throw new Error(friendlyIntegrationError(null, data));
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
