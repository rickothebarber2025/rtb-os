import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

const SESSION_KEY = 'rtb-os-anonymous-interaction-session';
const SAFE_VALUE = /[^a-z0-9:_-]/gi;

function safeValue(value, fallback = '') {
  return String(value || fallback).trim().toLowerCase().replace(SAFE_VALUE, '-').slice(0, 80);
}

function getSessionId() {
  if (typeof window === 'undefined') return 'server-session';
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const created = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return `session-${Date.now()}`;
  }
}

export default function InteractionTelemetry({ activePage, businessUnitId, enabled, staffHubTab }) {
  const sessionIdRef = useRef(getSessionId());
  const previousRef = useRef(null);
  const lastNavigationTapRef = useRef(null);
  const activeFormRef = useRef(null);

  const record = useCallback((event) => {
    if (!enabled || !supabase || !businessUnitId || businessUnitId === 'all-businesses') return;
    const row = {
      business_unit_id: businessUnitId,
      session_id: sessionIdRef.current,
      event_name: event.eventName,
      page: safeValue(event.page, 'unknown'),
      tab: event.tab ? safeValue(event.tab) : null,
      target: event.target ? safeValue(event.target) : null,
      duration_ms: Number.isFinite(event.durationMs) ? Math.max(0, Math.min(86400000, Math.round(event.durationMs))) : null,
      metadata: event.metadata || {},
    };
    supabase.from('app_interaction_events').insert(row).then(({ error }) => {
      if (error && import.meta.env.DEV) console.warn('Anonymous interaction event was not recorded.', error);
    });
  }, [businessUnitId, enabled]);

  useEffect(() => {
    const now = Date.now();
    const previous = previousRef.current;
    if (previous) {
      record({
        eventName: 'navigation',
        page: activePage,
        tab: activePage === 'staff-hub' ? staffHubTab : null,
        durationMs: now - previous.startedAt,
        metadata: {
          from_page: previous.page,
          from_tab: previous.tab || null,
        },
      });
    }
    previousRef.current = {
      page: safeValue(activePage, 'unknown'),
      tab: activePage === 'staff-hub' ? safeValue(staffHubTab) : null,
      startedAt: now,
    };
  }, [activePage, record, staffHubTab]);

  useEffect(() => {
    function handleClick(event) {
      const control = event.target?.closest?.('[data-nav-target]');
      if (!control) return;
      const target = safeValue(control.dataset.navTarget);
      if (!target) return;
      const now = Date.now();
      const last = lastNavigationTapRef.current;
      if (last?.target === target && now - last.at < 750) {
        record({ eventName: 'repeated_navigation', page: activePage, tab: staffHubTab, target });
      }
      lastNavigationTapRef.current = { target, at: now };
    }

    function handleFocus(event) {
      const form = event.target?.closest?.('form');
      if (!form || activeFormRef.current) return;
      activeFormRef.current = {
        page: safeValue(activePage, 'unknown'),
        tab: activePage === 'staff-hub' ? safeValue(staffHubTab) : null,
        startedAt: Date.now(),
      };
    }

    function handleSubmit() {
      activeFormRef.current = null;
    }

    function handleError(event) {
      record({
        eventName: 'client_error',
        page: activePage,
        tab: activePage === 'staff-hub' ? staffHubTab : null,
        target: event.type === 'unhandledrejection' ? 'promise' : 'runtime',
      });
    }

    document.addEventListener('click', handleClick, true);
    document.addEventListener('focusin', handleFocus, true);
    document.addEventListener('submit', handleSubmit, true);
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleError);
    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('focusin', handleFocus, true);
      document.removeEventListener('submit', handleSubmit, true);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleError);
    };
  }, [activePage, record, staffHubTab]);

  useEffect(() => () => {
    const form = activeFormRef.current;
    if (!form) return;
    record({
      eventName: 'form_abandoned',
      page: form.page,
      tab: form.tab,
      durationMs: Date.now() - form.startedAt,
    });
    activeFormRef.current = null;
  }, [activePage, record, staffHubTab]);

  return null;
}
