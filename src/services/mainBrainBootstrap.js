import {
  beginAccountLogin,
  finalizeAccountLogin,
  getPendingAccountLogin,
  listIntegrationConnections,
} from './integrationService';

const AUTO_CONNECT_GUARD = 'rtb:main-brain-google-auto-connect';
const MAIN_BRAIN_EVENT = 'rtb:main-brain-ready';

let inFlight = false;

function isOwnerProfile(profile) {
  const role = String(profile?.role || '').toLowerCase();
  const userType = String(profile?.user_type || '').toLowerCase();
  return role === 'owner' || userType === 'owner';
}

function connectionState(connections) {
  const connected = new Set(
    (connections || [])
      .filter((item) => item?.status === 'connected' || item?.status === 'configured')
      .map((item) => String(item.provider || '').toLowerCase()),
  );

  return {
    supabase: true,
    google: connected.has('google'),
    googleBusiness: connected.has('google_business'),
    github: connected.has('github'),
    square: connected.has('square'),
    jotform: connected.has('jotform'),
    openai: connected.has('openai'),
    connections: connections || [],
  };
}

function publishMainBrainState(connections) {
  if (typeof window === 'undefined') return;
  const state = connectionState(connections);
  window.__RTB_MAIN_BRAIN__ = state;
  window.dispatchEvent(new CustomEvent(MAIN_BRAIN_EVENT, { detail: state }));
}

async function finishPendingGoogleConnection() {
  const pending = getPendingAccountLogin();
  if (!pending || pending.provider !== 'google') return false;
  await finalizeAccountLogin('google', pending.businessUnitId || null);
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(AUTO_CONNECT_GUARD);
  }
  return true;
}

async function bootstrapOwnerMainBrain(detail) {
  if (inFlight || typeof window === 'undefined') return;
  if (!detail?.userId || !isOwnerProfile(detail.profile)) return;

  inFlight = true;
  try {
    await finishPendingGoogleConnection();

    let connections = await listIntegrationConnections();
    publishMainBrainState(connections);

    const googleConnected = connections.some(
      (item) => String(item?.provider || '').toLowerCase() === 'google' && item?.status === 'connected',
    );
    if (googleConnected) return;

    // Google sign-in authenticates RTB OS. This second, owner-only consent step
    // upgrades that account once with Gmail/Drive/Calendar/Contacts/Sheets read
    // scopes and stores the provider refresh token in the RTB OS credential vault.
    // Staff accounts never receive these business-data scopes.
    const guard = window.sessionStorage.getItem(AUTO_CONNECT_GUARD);
    if (guard) return;

    window.sessionStorage.setItem(AUTO_CONNECT_GUARD, String(Date.now()));
    await beginAccountLogin('google', null);
  } catch (error) {
    console.warn('[RTB Main Brain] bootstrap deferred:', error?.message || error);
    try {
      const connections = await listIntegrationConnections();
      publishMainBrainState(connections);
    } catch {
      // Keep sign-in usable even when an optional connector is unavailable.
    }
  } finally {
    inFlight = false;
  }
}

export function installMainBrainBootstrap() {
  if (typeof window === 'undefined') return () => {};

  const handler = (event) => {
    bootstrapOwnerMainBrain(event?.detail).catch(() => {});
  };

  window.addEventListener('rtb:auth-session-ready', handler);
  return () => window.removeEventListener('rtb:auth-session-ready', handler);
}

export { MAIN_BRAIN_EVENT };
