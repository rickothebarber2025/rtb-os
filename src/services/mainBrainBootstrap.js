import {
  beginAccountLogin,
  finalizeAccountLogin,
  getPendingAccountLogin,
  listIntegrationConnections,
} from './integrationService';

const AUTO_CONNECT_GUARD = 'rtb:main-brain-google-auto-connect';
const MAIN_BRAIN_EVENT = 'rtb:main-brain-ready';
const MAIN_BRAIN_MESSAGE = 'RTB_MAIN_BRAIN_CONTEXT';

let inFlight = false;
let latestIdentity = null;
let latestState = null;
const workbenchTargets = new Set();

function isOwnerProfile(profile) {
  const role = String(profile?.role || '').toLowerCase();
  const userType = String(profile?.user_type || '').toLowerCase();
  return role === 'owner' || userType === 'owner';
}

function safeIdentity(detail) {
  if (!detail?.userId) return null;
  return {
    userId: detail.userId,
    email: detail.email || detail.profile?.email || '',
    fullName: detail.profile?.full_name || '',
    role: detail.profile?.role || '',
    userType: detail.profile?.user_type || '',
  };
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
    booksy: connected.has('booksy'),
    jotform: connected.has('jotform'),
    openai: connected.has('openai'),
    connections: connections || [],
  };
}

function buildMainBrainPayload() {
  return {
    type: MAIN_BRAIN_MESSAGE,
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'RTB_OS_CONNECTION_BROKER',
    identity: latestIdentity,
    connections: latestState,
    rules: {
      sourceOfTruth: 'RTB OS / Supabase',
      noClientSecrets: true,
      reuseCentralConnections: true,
    },
  };
}

function sendMainBrainContext(target, origin = '*') {
  if (!target?.postMessage || !latestState) return;
  try {
    target.postMessage(buildMainBrainPayload(), origin || '*');
  } catch {
    // The target may have navigated or closed. It will re-register on ready.
  }
}

function publishMainBrainState(connections) {
  if (typeof window === 'undefined') return;
  latestState = connectionState(connections);
  window.__RTB_MAIN_BRAIN__ = {
    identity: latestIdentity,
    ...latestState,
  };
  window.dispatchEvent(new CustomEvent(MAIN_BRAIN_EVENT, {
    detail: window.__RTB_MAIN_BRAIN__,
  }));
  for (const target of workbenchTargets) sendMainBrainContext(target);
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

  latestIdentity = safeIdentity(detail);
  inFlight = true;
  try {
    await finishPendingGoogleConnection();

    const connections = await listIntegrationConnections();
    publishMainBrainState(connections);

    const googleConnected = connections.some(
      (item) => String(item?.provider || '').toLowerCase() === 'google' && item?.status === 'connected',
    );
    if (googleConnected) return;

    // Owner-only one-time consent upgrades the existing Google sign-in with
    // Gmail/Drive/Calendar/Contacts/Sheets read scopes. The provider refresh
    // token is stored in the RTB OS credential vault and reused by all RTB
    // surfaces instead of creating project-specific Google keys.
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

  const authHandler = (event) => {
    bootstrapOwnerMainBrain(event?.detail).catch(() => {});
  };

  const workbenchHandler = (event) => {
    if (event.data?.type !== 'RTB_WORKBENCH_READY') return;
    if (!event.source) return;
    workbenchTargets.add(event.source);
    sendMainBrainContext(event.source, event.origin || '*');
  };

  window.addEventListener('rtb:auth-session-ready', authHandler);
  window.addEventListener('message', workbenchHandler);

  return () => {
    window.removeEventListener('rtb:auth-session-ready', authHandler);
    window.removeEventListener('message', workbenchHandler);
    workbenchTargets.clear();
  };
}

export { MAIN_BRAIN_EVENT, MAIN_BRAIN_MESSAGE };
