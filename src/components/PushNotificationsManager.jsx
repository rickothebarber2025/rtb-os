import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '../lib/supabaseClient';

const IOS_BUNDLE_ID = 'com.rtbheadquaters.os';

function getPushTarget(notification) {
  const data = notification?.notification?.data || notification?.data || {};
  const rtb = data?.rtb || data || {};
  return rtb?.page || null;
}

export default function PushNotificationsManager({ enabled, setActivePage }) {
  useEffect(() => {
    if (!enabled || !supabase || !Capacitor.isNativePlatform()) return undefined;

    let cancelled = false;
    const listenerHandles = [];

    async function registerToken(tokenValue) {
      if (!tokenValue || cancelled) return;
      const { error } = await supabase.rpc('register_my_push_token', {
        p_token: tokenValue,
        p_platform: Capacitor.getPlatform(),
        p_bundle_id: IOS_BUNDLE_ID,
      });
      if (error) console.error('Unable to register RTB push token', error);
    }

    async function setupPush() {
      try {
        listenerHandles.push(
          await PushNotifications.addListener('registration', (token) => registerToken(token.value)),
        );
        listenerHandles.push(
          await PushNotifications.addListener('registrationError', (error) => {
            console.error('RTB push registration failed', error);
          }),
        );
        listenerHandles.push(
          await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            const target = getPushTarget(action);
            if (target && typeof setActivePage === 'function') setActivePage(target);
          }),
        );

        const current = await PushNotifications.checkPermissions();
        let permission = current.receive;
        if (permission === 'prompt' || permission === 'prompt-with-rationale') {
          const requested = await PushNotifications.requestPermissions();
          permission = requested.receive;
        }
        if (permission !== 'granted') return;
        await PushNotifications.register();
      } catch (error) {
        console.error('RTB push setup failed', error);
      }
    }

    setupPush();

    return () => {
      cancelled = true;
      listenerHandles.forEach((handle) => handle?.remove?.());
    };
  }, [enabled, setActivePage]);

  return null;
}
