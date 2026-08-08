import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabaseClient';

const PUSH_TOKEN_KEY = 'rtb-os-ios-push-token';
let initialized = false;
let pendingToken = '';

async function saveToken(token) {
  if (!token || !supabase) return;
  pendingToken = token;
  try {
    window.localStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch {
    // Local storage is only a convenience; Supabase is the source of truth.
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.user) return;

  const { error } = await supabase.rpc('register_my_push_token', {
    p_token: token,
    p_platform: 'ios',
    p_device_name: navigator.userAgent || 'iPhone',
    p_app_id: 'com.rtbheadquaters.os',
  });

  if (error) {
    console.error('RTB push token registration failed', error);
  }
}

async function syncStoredToken() {
  if (!supabase) return;
  let token = pendingToken;
  try {
    token ||= window.localStorage.getItem(PUSH_TOKEN_KEY) || '';
  } catch {
    // Ignore storage errors.
  }
  if (token) await saveToken(token);
}

export async function initializePushNotifications() {
  if (initialized || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return;
  initialized = true;

  await PushNotifications.addListener('registration', ({ value }) => {
    saveToken(value);
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.error('RTB push registration error', error);
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
        syncStoredToken();
      }
    });
  }

  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt') {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') return;

  await PushNotifications.register();
}
