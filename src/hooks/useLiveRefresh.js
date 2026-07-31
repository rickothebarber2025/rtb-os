import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { syncSquareAppointments } from '../services/rtbService';
import { isAllBusinessesUnit, usesSquareAppointments } from '../utils/businessProfiles';

const CORE_REFRESH_TABLES = [
  'app_settings',
  'booth_rent',
  'business_units',
  'payroll_entries',
  'payroll_runs',
  'performance_history',
  'staff',
  'staff_announcements',
  'staff_content_submissions',
  'staff_tasks',
  'staff_time_off_requests',
  'user_profiles',
];

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const FOCUS_COOLDOWN_MS = 25 * 1000;
const REALTIME_COOLDOWN_MS = 6 * 1000;
const SQUARE_AUTO_ATTEMPT_COOLDOWN_MS = 5 * 60 * 1000;

function isPageVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function scopeKey(value) {
  return String(value || 'global').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80);
}

export function useLiveRefresh({
  enabled,
  intervalMs = DEFAULT_INTERVAL_MS,
  loading = false,
  refresh,
  scope = 'global',
}) {
  const enabledRef = useRef(enabled);
  const inFlightRef = useRef(false);
  const lastRunRef = useRef(0);
  const loadingRef = useRef(loading);
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const refreshRef = useRef(refresh);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const runRefresh = useCallback((reason = 'auto', options = {}) => {
    if (!enabledRef.current || typeof refreshRef.current !== 'function') return;
    if (loadingRef.current) return;
    if (reason === 'interval' && !isPageVisible()) return;

    const cooldownMs = Number(options.cooldownMs ?? FOCUS_COOLDOWN_MS);
    const now = Date.now();
    if (cooldownMs > 0 && now - lastRunRef.current < cooldownMs) return;

    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }

    inFlightRef.current = true;
    lastRunRef.current = now;

    Promise.resolve(refreshRef.current({ reason, silent: true }))
      .catch((err) => {
        console.warn(`RTB OS live refresh failed (${reason}):`, err);
      })
      .finally(() => {
        inFlightRef.current = false;

        if (pendingRef.current && mountedRef.current && enabledRef.current && isPageVisible()) {
          pendingRef.current = false;
          window.setTimeout(() => {
            if (mountedRef.current) {
              runRefresh('queued', { cooldownMs: REALTIME_COOLDOWN_MS });
            }
          }, 250);
        }
      });
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const handleFocus = () => runRefresh('focus', { cooldownMs: FOCUS_COOLDOWN_MS });
    const handleOnline = () => runRefresh('online', { cooldownMs: 0 });
    const handleVisibility = () => {
      if (isPageVisible()) runRefresh('visible', { cooldownMs: FOCUS_COOLDOWN_MS });
    };
    const intervalId = window.setInterval(() => {
      runRefresh('interval', { cooldownMs: Math.max(intervalMs - 5000, 0) });
    }, intervalMs);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, intervalMs, runRefresh]);

  useEffect(() => {
    if (!enabled || !supabase) return undefined;

    const channel = supabase.channel(`rtb-os-live-${scopeKey(scope)}`);
    CORE_REFRESH_TABLES.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => runRefresh(`realtime:${table}`, { cooldownMs: REALTIME_COOLDOWN_MS }),
      );
    });

    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`RTB OS realtime refresh channel status: ${status}`);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, runRefresh, scope]);

  return { runRefresh };
}

export function useSquareAutoSync({
  businessUnit,
  enabled,
  refresh,
  squareStatus,
}) {
  const attemptRef = useRef({ businessUnitId: '', lastAttemptAt: 0 });

  useEffect(() => {
    if (!enabled || !businessUnit || isAllBusinessesUnit(businessUnit)) return;
    if (!usesSquareAppointments(businessUnit)) return;
    if (!squareStatus?.connected || squareStatus?.sync?.allowed !== true) return;

    const now = Date.now();
    const lastAttempt = attemptRef.current;
    if (
      lastAttempt.businessUnitId === businessUnit.id &&
      now - lastAttempt.lastAttemptAt < SQUARE_AUTO_ATTEMPT_COOLDOWN_MS
    ) {
      return;
    }

    let cancelled = false;
    attemptRef.current = { businessUnitId: businessUnit.id, lastAttemptAt: now };

    async function syncIfAllowed() {
      try {
        await syncSquareAppointments(businessUnit.id);
        if (!cancelled && typeof refresh === 'function') {
          await refresh({ reason: 'square-auto-sync', silent: true });
        }
      } catch (err) {
        console.warn('RTB OS Square auto-sync skipped:', err);
      }
    }

    syncIfAllowed();

    return () => {
      cancelled = true;
    };
  }, [businessUnit, enabled, refresh, squareStatus]);
}
