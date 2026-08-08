import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabaseClient';

const PUSH_TOKEN_KEY = 'rtb-os-ios-push-token';
const PUSH_STATUS_KEY = 'rtb-os-push-status';
let initialized = false;
let pendingToken = '';

function setStatus(status, details = '') {
  const payload = { status, details, at: new Date().toISOString() };
  try {
    window.localStorage.setItem(PUSH_STATUS_KEY, JSON.stringify(payload));
  } catch {
    // Diagnostics are best-effort only.
  }
  console.info('[RTB Push]', status, details || '');
}

async function saveToken(token) {
  if (!token || !supabase) return false;
  pendingToken = token;
  try {
    window.localStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch {
    // Local storage is only a convenience; Supabase is the source of truth.
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    setStatus('session_error', sessionError.message);
    return false;
  }
  if (!sessionData?.session?.user) {
    setStatus('token_waiting_for_login');
    return false;
  }

  const { error } = await supabase.rpc('register_my_push_token', {
    p_token: token,
    p_platform: 'ios',
    p_device_name: navigator.userAgent || 'iPhone',
    p_app_id: 'com.rtbheadquaters.os',
  });

  if (error) {
    setStatus('supabase_registration_error', error.message || String(error));
    return false;
  }

  setStatus('registered_with_supabase');
  return true;
}

async function syncStoredToken() {
  if (!supabase) return false;
  let token = pendingToken;
  try {
    token ||= window.localStorage.getItem(PUSH_TOKEN_KEY) || '';
  } catch {
    // Ignore storage errors.
  }
  if (!token) return false;
  return saveToken(token);
}

export async function initializePushNotifications() {
  if (initialized) return;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') {
    setStatus('not_native_ios');
    return;
  }
  initialized = true;
  setStatus('initializing');

  await PushNotifications.addListener('registration', async ({ value }) => {
    setStatus('apns_token_received');
    await saveToken(value);
  });

  await PushNotifications.addListener('registrationError', (error) => {
    setStatus('apns_registration_error', error?.error || error?.message || JSON.stringify(error));
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    setStatus('push_received', notification?.title || 'notification');
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const route = notification?.data?.route;
    if (route) {
      try {
        window.localStorage.setItem('rtb-os-push-route', String(route));
      } catch {
        // Ignore storage errors.
      }
      window.dispatchEvent(new CustomEvent('rtb:push-navigation', { detail: { route, data: notification?.data || {} } }));
    }
  });

  if (supabase) {
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        window.setTimeout(() => {
          syncStoredToken().catch((error) => {
            setStatus('token_resync_error', error?.message || String(error));
          });
        }, 250);
      }
    });
  }

  let permission = await PushNotifications.checkPermissions();
  setStatus('permission_checked', permission.receive);
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions();
    setStatus('permission_requested', permission.receive);
  }
  if (permission.receive !== 'granted') {
    setStatus('permission_not_granted', permission.receive);
    return;
  }

  setStatus('registering_with_apns');
  await PushNotifications.register();

  // If APNs produced a token before the auth session was ready, this catches it.
  window.setTimeout(() => {
    syncStoredToken().catch((error) => {
      setStatus('delayed_token_sync_error', error?.message || String(error));
    });
  }, 3000);
}
