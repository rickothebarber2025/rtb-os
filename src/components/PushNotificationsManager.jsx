import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  initializePushNotifications,
  syncStoredPushToken,
} from '../lib/pushNotifications';

export default function PushNotificationsManager({ enabled, setActivePage }) {
  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return undefined;

    let cancelled = false;
    let retryTimer = null;

    async function syncAuthenticatedDevice() {
      try {
        // initializePushNotifications is idempotent. If APNs already delivered a
        // token before login, this immediately retries that stored token now that
        // AppShell knows the authenticated profile is active.
        await initializePushNotifications();
        const registered = await syncStoredPushToken();
        if (!registered && !cancelled) {
          retryTimer = window.setTimeout(syncAuthenticatedDevice, 2000);
        }
      } catch (error) {
        console.error('[RTB Push] authenticated token sync failed', error);
        if (!cancelled) retryTimer = window.setTimeout(syncAuthenticatedDevice, 2000);
      }
    }

    function handlePushNavigation(event) {
      const target = event?.detail?.route;
      if (target && typeof setActivePage === 'function') setActivePage(target);
    }

    function handleAuthReady() {
      syncAuthenticatedDevice();
    }

    window.addEventListener('rtb:push-navigation', handlePushNavigation);
    window.addEventListener('rtb:auth-session-ready', handleAuthReady);
    syncAuthenticatedDevice();

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.removeEventListener('rtb:push-navigation', handlePushNavigation);
      window.removeEventListener('rtb:auth-session-ready', handleAuthReady);
    };
  }, [enabled, setActivePage]);

  return null;
}
