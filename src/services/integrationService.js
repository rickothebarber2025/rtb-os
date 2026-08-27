import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

const GOOGLE_PROVIDER_SCOPES = {
  google: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  google_business: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/business.manage',
  ],
};

const PENDING_ACCOUNT_LOGIN_KEY = 'rtb:pending-integration-account-login';

function friendlyIntegrationError(error, data) {
  const code = String(data?.code || '').trim();
  if (code === 'AUTH_REQUIRED') return 'Your RTB OS session expired. Sign in again or refresh and retry.';
  if (code === 'OWNER_REQUIRED') return 'Owner access is required to manage integrations.';
  if (code === 'PROVIDER_REQUIRED') return 'Choose an integration and try again.';
  if (code === 'SETUP_REQUIRED') return 'This connection is not enabled on the RTB OS server yet.';

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

function writePendingAccountLogin(provider, businessUnitId) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(PENDING_ACCOUNT_LOGIN_KEY, JSON.stringify({
    provider,
    businessUnitId: businessUnitId || null,
    startedAt: Date.now(),
  }));
}

function clearPendingAccountLogin() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PENDING_ACCOUNT_LOGIN_KEY);
}

export function getPendingAccountLogin() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_ACCOUNT_LOGIN_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!GOOGLE_PROVIDER_SCOPES[pending?.provider]) {
      clearPendingAccountLogin();
      return null;
    }
    if (!pending?.startedAt || Date.now() - Number(pending.startedAt) > 15 * 60 * 1000) {
      clearPendingAccountLogin();
      return null;
    }
    return {
      provider: pending.provider,
      businessUnitId: pending.businessUnitId || null,
    };
  } catch {
    clearPendingAccountLogin();
    return null;
  }
}

export async function listIntegrationConnections() {
  const result = await invoke('list');
  return Array.isArray(result.connections) ? result.connections : [];
}

export async function beginIntegrationConnection(provider, businessUnitId) {
  return invoke('begin_connect', { provider, businessUnitId: businessUnitId || null });
}

export async function beginAccountLogin(provider, businessUnitId) {
  if (!GOOGLE_PROVIDER_SCOPES[provider]) return null;
  if (!isSupabaseConfigured || !supabase) throw new Error('RTB OS sign-in is not configured.');

  writePendingAccountLogin(provider, businessUnitId);

  const returnUrl = new URL(window.location.href);
  returnUrl.searchParams.set('integration_return', provider);
  if (businessUnitId) returnUrl.searchParams.set('integration_business', businessUnitId);
  else returnUrl.searchParams.delete('integration_business');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: returnUrl.toString(),
      scopes: GOOGLE_PROVIDER_SCOPES[provider].join(' '),
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      },
    },
  });
  if (error) {
    clearPendingAccountLogin();
    throw error;
  }
  if (data?.url) window.location.assign(data.url);
  return data || {};
}

export async function finalizeAccountLogin(provider, businessUnitId) {
  if (!GOOGLE_PROVIDER_SCOPES[provider]) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data?.session;
  if (!session?.provider_token) {
    throw new Error('Google sign-in completed, but Google did not return an account access token. Reconnect and approve the requested permissions.');
  }

  const result = await invoke('capture_oauth_session', {
    provider,
    businessUnitId: businessUnitId || null,
    accessToken: session.provider_token,
    refreshToken: session.provider_refresh_token || '',
    scopes: GOOGLE_PROVIDER_SCOPES[provider],
  });
  clearPendingAccountLogin();
  return result;
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
