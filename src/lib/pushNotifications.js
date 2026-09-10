import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabaseClient';

const PUSH_TOKEN_KEY = 'rtb-os-ios-push-token';
const PUSH_STATUS_KEY = 'rtb-os-push-status';
const PUSH_DESTINATION_KEY = 'rtb-os-push-destination';
const PUSH_BUNDLE_ID = 'com.rtbheadquaters.os';
let initialized = false;
let pendingToken = '';
let retryTimer = null;
let retryCount = 0;

function setStatus(status, details = '') {
  const payload = { status, details, at: new Date().toISOString() };
  try { window.localStorage.setItem(PUSH_STATUS_KEY, JSON.stringify(payload)); } catch { /* best effort */ }
  console.info('[RTB Push]', status, details || '');
  // TEMP DIAGNOSTIC (2026-09-10) - remove once push registration is confirmed working.
  try {
    if (supabase) {
      supabase.from('app_client_errors').insert({
        message: `[RTB Push] ${status}${details ? ': ' + String(details).slice(0, 500) : ''}`,
        page: 'push-notifications-debug',
      }).then(() => {}).catch(() => {});
    }
  } catch { /* never let diagnostics break push registration */ }
}

function readStoredToken() {
  if (pendingToken) return pendingToken;
  try { return window.localStorage.getItem(PUSH_TOKEN_KEY) || ''; } catch { return ''; }
}

function stopRetryLoop() {
  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = null;
  retryCount = 0;
}

async function registerTokenWithSupabase(token) {
  if (!token || !supabase) return false;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) { setStatus('session_error', sessionError.message); return false; }
  const session = sessionData?.session;
  if (!session?.user) { setStatus('token_waiting_for_login'); return false; }

  const { data, error } = await supabase.rpc('register_my_push_token', {
    p_token: token,
    p_platform: 'ios',
    p_bundle_id: PUSH_BUNDLE_ID,
  });
  if (error) { setStatus('supabase_registration_error', error.message || String(error)); return false; }
  setStatus('registered_with_supabase', data ? String(data) : 'ok');
  stopRetryLoop();
  return true;
}

async function saveToken(token) {
  if (!token) return false;
  pendingToken = token;
  try { window.localStorage.setItem(PUSH_TOKEN_KEY, token); } catch { /* source of truth is Supabase */ }
  return registerTokenWithSupabase(token);
}

export async function syncStoredPushToken() {
  const token = readStoredToken();
  if (!token) { setStatus('no_stored_push_token'); return false; }
  return registerTokenWithSupabase(token);
}

function scheduleAuthRetry() {
  if (retryTimer || retryCount >= 30) return;
  retryTimer = window.setTimeout(async () => {
    retryTimer = null;
    retryCount += 1;
    try {
      const registered = await syncStoredPushToken();
      if (!registered) scheduleAuthRetry();
    } catch (error) {
      setStatus('token_retry_error', error?.message || String(error));
      scheduleAuthRetry();
    }
  }, 2000);
}

function requestTokenSync() {
  syncStoredPushToken().then((registered) => {
    if (!registered) scheduleAuthRetry();
  }).catch((error) => {
    setStatus('token_resync_error', error?.message || String(error));
    scheduleAuthRetry();
  });
}

function pushDetail(notification) {
  const data = notification?.data || {};
  return {
    route: data.route || data.page || '',
    data,
    title: notification?.title || '',
    body: notification?.body || '',
  };
}

function persistPushDestination(detail) {
  try { window.localStorage.setItem(PUSH_DESTINATION_KEY, JSON.stringify(detail)); } catch { /* best effort */ }
}

export async function initializePushNotifications() {
  if (initialized) { requestTokenSync(); return; }
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') { setStatus('not_native_ios'); return; }

  initialized = true;
  setStatus('initializing');

  await PushNotifications.addListener('registration', async ({ value }) => {
    setStatus('apns_token_received');
    const registered = await saveToken(value);
    if (!registered) scheduleAuthRetry();
  });

  await PushNotifications.addListener('registrationError', (error) => {
    setStatus('apns_registration_error', error?.error || error?.message || JSON.stringify(error));
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    const detail = pushDetail(notification);
    setStatus('push_received', notification?.title || 'notification');
    window.dispatchEvent(new CustomEvent('rtb:notification-received', { detail }));
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const detail = pushDetail(notification);
    persistPushDestination(detail);
    window.dispatchEvent(new CustomEvent('rtb:push-navigation', { detail }));
  });

  if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        window.setTimeout(requestTokenSync, 100);
      }
    });
  }

  window.addEventListener('rtb:auth-session-ready', requestTokenSync);
  window.addEventListener('focus', requestTokenSync);
  window.addEventListener('pageshow', requestTokenSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestTokenSync();
  });

  let permission = await PushNotifications.checkPermissions();
  setStatus('permission_checked', permission.receive);
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions();
    setStatus('permission_requested', permission.receive);
  }
  if (permission.receive !== 'granted') { setStatus('permission_not_granted', permission.receive); return; }

  requestTokenSync();
  setStatus('registering_with_apns');
  await PushNotifications.register();
  scheduleAuthRetry();
}
