import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  initializePushNotifications,
  syncStoredPushToken,
} from '../lib/pushNotifications';

function normalizePushDestination(detail = {}) {
  const data = detail?.data || {};
  const route = detail?.route || data.route || data.page || '';
  const tab = data.tab || data.staff_hub_tab || '';

  if (route === 'cleaning' || route === 'daily-ops' || route === 'opening' || route === 'closing') {
    return { page: 'staff-hub', tab: 'daily' };
  }
  if (route === 'announcements' || route === 'updates') {
    return { page: 'staff-hub', tab: 'home' };
  }
  if (route === 'performance' || route === 'coaching') {
    return { page: 'staff-hub', tab: 'stats' };
  }
  return { page: route || 'staff-hub', tab };
}

export default function PushNotificationsManager({ enabled, setActivePage, setStaffHubTab }) {
  useEffect(() => {
    if (!enabled || !Capacitor.isNativePlatform()) return undefined;

    let cancelled = false;
    let retryTimer = null;

    async function syncAuthenticatedDevice() {
      try {
        await initializePushNotifications();
        const registered = await syncStoredPushToken();
        if (!registered && !cancelled) retryTimer = window.setTimeout(syncAuthenticatedDevice, 2000);
      } catch (error) {
        console.error('[RTB Push] authenticated token sync failed', error);
        if (!cancelled) retryTimer = window.setTimeout(syncAuthenticatedDevice, 2000);
      }
    }

    function navigate(detail) {
      const destination = normalizePushDestination(detail);
      if (destination.tab && typeof setStaffHubTab === 'function') setStaffHubTab(destination.tab);
      if (destination.page && typeof setActivePage === 'function') setActivePage(destination.page);
    }

    function handlePushNavigation(event) {
      navigate(event?.detail || {});
    }

    function handleAuthReady() {
      syncAuthenticatedDevice();
      try {
        const raw = window.localStorage.getItem('rtb-os-push-destination');
        if (raw) {
          window.localStorage.removeItem('rtb-os-push-destination');
          navigate(JSON.parse(raw));
        }
      } catch {
        // A stale or malformed destination must never block app startup.
      }
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
  }, [enabled, setActivePage, setStaffHubTab]);

  return null;
}
