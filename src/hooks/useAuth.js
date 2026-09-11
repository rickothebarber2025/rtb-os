import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { onAppEvent } from '../lib/appEvents';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import {
  createPendingUserProfile,
  getCurrentUserProfile,
} from '../services/rtbService';

const EMAIL_AUTH_TYPES = new Set(['email', 'email_change', 'invite', 'magiclink', 'recovery', 'signup']);
const NATIVE_AUTH_CALLBACK_URL = 'com.rtbheadquaters.os://auth/callback';
const NATIVE_AUTH_RELAY_PARAM = 'rtb_native_auth';
const FALLBACK_WEB_ORIGIN = 'https://rtbheadquaters.com';
const SESSION_LOAD_TIMEOUT_MS = 8000;

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

function getNativeRelayUrl() {
  const candidate = /^https:\/\//i.test(window.location.origin)
    ? window.location.origin
    : FALLBACK_WEB_ORIGIN;
  const url = new URL(candidate);
  url.searchParams.set(NATIVE_AUTH_RELAY_PARAM, '1');
  return url.toString();
}

function getAuthRedirectUrl() {
  return isNativeApp() ? getNativeRelayUrl() : window.location.origin;
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

function relayBrowserAuthReturnToNative(sourceUrl = window.location.href) {
  if (isNativeApp()) return false;
  const source = new URL(sourceUrl);
  if (source.searchParams.get(NATIVE_AUTH_RELAY_PARAM) !== '1') return false;

  const params = readAuthRedirectParams(sourceUrl);
  const hasAuthResult = Boolean(
    params.accessToken || params.code || params.error || params.refreshToken || params.tokenHash,
  );
  if (!hasAuthResult) return false;

  const native = new URL(NATIVE_AUTH_CALLBACK_URL);
  source.searchParams.forEach((value, key) => {
    if (key !== NATIVE_AUTH_RELAY_PARAM) native.searchParams.set(key, value);
  });
  native.hash = source.hash;
  window.location.replace(native.toString());
  return true;
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
    return 'That sign-in link is expired, invalid, or already used. Please start sign-in again.';
  }
  return message || 'Unable to finish sign-in.';
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

    let settled = false;
    const failOpenTimer = window.setTimeout(() => {
      if (settled || !active) return;
      settled = true;
      setAuthError((current) => current || 'Sign-in took longer than expected. Please try again.');
      setLoading(false);
    }, SESSION_LOAD_TIMEOUT_MS);

    async function loadSession() {
      try {
        setAuthError('');
        if (relayBrowserAuthReturnToNative()) return;
        await completeAuthRedirect();
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!active || settled) return;
        setSession(data.session);
        notifySessionReady(data.session);
      } catch (err) {
        if (!active || settled) return;
        setAuthError(getAuthRedirectErrorMessage(err));
        setSession(null);
      } finally {
        if (active && !settled) {
          settled = true;
          window.clearTimeout(failOpenTimer);
          setLoading(false);
        }
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
      settled = true;
      window.clearTimeout(failOpenTimer);
      setSession(nextSession);
      setLoading(false);
    });

    return () => { active = false; window.clearTimeout(failOpenTimer); subscription.unsubscribe(); };
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

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined;
    const userId = session.user.id;
    const channel = supabase
      .channel(`user-profile-access-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_profiles',
        filter: `id=eq.${userId}`,
      }, () => {
        window.setTimeout(() => refreshProfile(), 50);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [refreshProfile, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    const userId = session.user.id;
    return onAppEvent((event) => {
      if (event?.type !== 'access.changed') return;
      const changedUserId = String(event.detail?.userId || '');
      if (!changedUserId || changedUserId === userId) {
        window.setTimeout(() => refreshProfile(), 30);
      }
    });
  }, [refreshProfile, session?.user?.id]);

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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirectUrl(),
        skipBrowserRedirect: native,
        scopes: 'openid email profile',
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    if (native) {
      if (!data?.url) throw new Error('Google did not return an authorization URL.');
      await Browser.open({ presentationStyle: 'fullscreen', url: data.url });
    }
  }, []);
  const signInWithApple = useCallback(async () => {
    const native = isNativeApp();
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: getAuthRedirectUrl(), skipBrowserRedirect: native } });
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
    profile, profileError, refreshProfile, sendMagicLink, session, signInWithApple, signInWithGoogle,
    signInWithPassword, signOut, signUp, user: session?.user ?? null,
  }), [authError, loading, profile, profileError, profileLoading, refreshProfile, sendMagicLink, session, signInWithApple, signInWithGoogle, signInWithPassword, signOut, signUp]);
}
