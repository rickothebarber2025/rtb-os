import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import {
  createPendingUserProfile,
  getCurrentUserProfile,
} from '../services/rtbService';

const EMAIL_AUTH_TYPES = new Set(['email', 'email_change', 'invite', 'magiclink', 'recovery', 'signup']);
const NATIVE_AUTH_CALLBACK_URL = 'com.rtbheadquaters.os://auth/callback';

function isNativeApp() {
  return Capacitor.isNativePlatform();
}

function notifySessionReady(session, profile = null) {
  if (!session?.user || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rtb:auth-session-ready', {
    detail: {
      userId: session.user.id,
      email: session.user.email || '',
      profile,
    },
  }));
}

function getAuthRedirectUrl() {
  return isNativeApp() ? NATIVE_AUTH_CALLBACK_URL : window.location.origin;
}

function isNativeAuthRedirect(url) {
  return typeof url === 'string' && url.startsWith(NATIVE_AUTH_CALLBACK_URL);
}

function readAuthRedirectParams(sourceUrl = window.location.href) {
  const url = new URL(sourceUrl);
  const searchParams = url.searchParams;
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const get = (key) => searchParams.get(key) || hashParams.get(key) || '';

  return {
    accessToken: get('access_token'),
    code: get('code'),
    error: get('error_description') || get('error'),
    refreshToken: get('refresh_token'),
    tokenHash: get('token_hash'),
    type: get('type'),
  };
}

function clearAuthRedirectParams(sourceUrl = window.location.href) {
  if (!sourceUrl.startsWith(window.location.origin)) return;
  window.history.replaceState(window.history.state, '', window.location.origin);
}

async function closeNativeAuthBrowser() {
  if (!isNativeApp()) return;
  try { await Browser.close(); } catch { /* no auth browser open */ }
}

function getAuthRedirectErrorMessage(error) {
  const message = error?.message || String(error || '');
  if (/expired|invalid|used|otp|token/i.test(message)) {
    return 'That invite link is expired or already used. Ask an admin to send a new invite, or use a magic link to sign in.';
  }
  return message || 'Unable to finish the invite sign-in.';
}

async function completeAuthRedirect(sourceUrl = window.location.href) {
  const params = readAuthRedirectParams(sourceUrl);
  if (params.error) throw new Error(params.error);

  if (params.accessToken && params.refreshToken) {
    const { data, error } = await supabase.auth.setSession({ access_token: params.accessToken, refresh_token: params.refreshToken });
    if (error) throw error;
    clearAuthRedirectParams(sourceUrl);
    return data.session || null;
  }
  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) throw error;
    clearAuthRedirectParams(sourceUrl);
    return data.session || null;
  }
  if (params.tokenHash && EMAIL_AUTH_TYPES.has(params.type)) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type });
    if (error) throw error;
    clearAuthRedirectParams(sourceUrl);
    return data.session || null;
  }
  return null;
}

export function useAuth() {
  const [session, setSession] = useState(null);
  const [authError, setAuthError] = useState('');
  const intentionalSignOutRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured) { setLoading(false); return undefined; }

    async function loadSession() {
      try {
        setAuthError('');
        await completeAuthRedirect();
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active) return;
        setSession(data.session);
        notifySessionReady(data.session);
      } catch (err) {
        if (!active) return;
        setAuthError(getAuthRedirectErrorMessage(err));
        setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession) {
        setAuthError('');
        window.setTimeout(() => notifySessionReady(nextSession), 0);
      } else if (event === 'SIGNED_OUT') {
        if (intentionalSignOutRef.current) intentionalSignOutRef.current = false;
        else setAuthError((current) => current || 'Your session ended. Please sign in again to continue.');
      }
      setSession(nextSession);
      setLoading(false);
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !isNativeApp()) return undefined;
    let active = true;
    let appUrlOpenListener = null;

    async function handleNativeAuthReturn(url) {
      if (!isNativeAuthRedirect(url)) return;
      try {
        setLoading(true);
        setAuthError('');
        await closeNativeAuthBrowser();
        const nextSession = await completeAuthRedirect(url);
        if (!active) return;
        if (nextSession) {
          setSession(nextSession);
          notifySessionReady(nextSession);
          return;
        }
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (active) {
          setSession(data.session);
          notifySessionReady(data.session);
        }
      } catch (err) {
        if (!active) return;
        setAuthError(getAuthRedirectErrorMessage(err));
        setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    CapacitorApp.addListener('appUrlOpen', ({ url }) => { handleNativeAuthReturn(url); }).then((listener) => {
      if (active) appUrlOpenListener = listener;
      else listener.remove();
    });
    CapacitorApp.getLaunchUrl().then(({ url }) => { if (active && url) handleNativeAuthReturn(url); });
    return () => { active = false; appUrlOpenListener?.remove(); };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) {
      setProfile(null); setProfileError(''); setProfileLoading(false); return null;
    }
    setProfileLoading(true); setProfileError('');
    try {
      let nextProfile = await getCurrentUserProfile(session.user.id);
      if (!nextProfile) nextProfile = await createPendingUserProfile(session.user);
      setProfile(nextProfile);
      notifySessionReady(session, nextProfile);
      return nextProfile;
    } catch (err) {
      setProfile(null);
      setProfileError(err.message || 'Unable to load your access profile.');
      return null;
    } finally { setProfileLoading(false); }
  }, [session]);

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      if (!session?.user) {
        if (!active) return;
        setProfile(null); setProfileError(''); setProfileLoading(false); return;
      }
      setProfileLoading(true); setProfileError('');
      try {
        let nextProfile = await getCurrentUserProfile(session.user.id);
        if (!nextProfile) nextProfile = await createPendingUserProfile(session.user);
        if (active) {
          setProfile(nextProfile);
          notifySessionReady(session, nextProfile);
        }
      } catch (err) {
        if (!active) return;
        setProfile(null);
        setProfileError(err.message || 'Unable to load your access profile.');
      } finally { if (active) setProfileLoading(false); }
    }
    loadProfile();
    return () => { active = false; };
  }, [session?.user?.email, session?.user?.id]);

  const signInWithPassword = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);
  const signUp = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: getAuthRedirectUrl() } });
    if (error) throw error;
  }, []);
  const sendMagicLink = useCallback(async (email) => {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: getAuthRedirectUrl() } });
    if (error) throw error;
  }, []);
  const signInWithGoogle = useCallback(async () => {
    const native = isNativeApp();
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: getAuthRedirectUrl(), skipBrowserRedirect: native } });
    if (error) throw error;
    if (native && data?.url) await Browser.open({ presentationStyle: 'fullscreen', url: data.url });
  }, []);
  const signOut = useCallback(async () => {
    if (!supabase) return;
    intentionalSignOutRef.current = true;
    setProfile(null); setProfileError('');
    await supabase.auth.signOut();
  }, []);

  return useMemo(() => ({
    isConfigured: isSupabaseConfigured,
    authError,
    loading: loading || profileLoading || Boolean(session && !profile && !profileError),
    profile, profileError, refreshProfile, sendMagicLink, session, signInWithGoogle,
    signInWithPassword, signOut, signUp, user: session?.user ?? null,
  }), [authError, loading, profile, profileError, profileLoading, refreshProfile, sendMagicLink, session, signInWithGoogle, signInWithPassword, signOut, signUp]);
}
