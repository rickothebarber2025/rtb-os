import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import {
  createPendingUserProfile,
  getCurrentUserProfile,
} from '../services/rtbService';

const EMAIL_AUTH_TYPES = new Set(['email', 'email_change', 'invite', 'magiclink', 'recovery', 'signup']);

function readAuthRedirectParams() {
  const url = new URL(window.location.href);
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

function clearAuthRedirectParams() {
  window.history.replaceState(window.history.state, '', window.location.origin);
}

function getAuthRedirectErrorMessage(error) {
  const message = error?.message || String(error || '');

  if (/expired|invalid|used|otp|token/i.test(message)) {
    return 'That invite link is expired or already used. Ask an admin to send a new invite, or use a magic link to sign in.';
  }

  return message || 'Unable to finish the invite sign-in.';
}

async function completeAuthRedirect() {
  const params = readAuthRedirectParams();

  if (params.error) {
    throw new Error(params.error);
  }

  if (params.accessToken && params.refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });

    if (error) throw error;
    clearAuthRedirectParams();
    return data.session || null;
  }

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);

    if (error) throw error;
    clearAuthRedirectParams();
    return data.session || null;
  }

  if (params.tokenHash && EMAIL_AUTH_TYPES.has(params.type)) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type,
    });

    if (error) throw error;
    clearAuthRedirectParams();
    return data.session || null;
  }

  return null;
}

export function useAuth() {
  const [session, setSession] = useState(null);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    let active = true;

    if (!isSupabaseConfigured) {
      setLoading(false);
      return undefined;
    }

    async function loadSession() {
      try {
        setAuthError('');
        await completeAuthRedirect();

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!active) return;
        setSession(data.session);
      } catch (err) {
        if (!active) return;
        setAuthError(getAuthRedirectErrorMessage(err));
        setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession) setAuthError('');
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) {
      setProfile(null);
      setProfileError('');
      setProfileLoading(false);
      return null;
    }

    setProfileLoading(true);
    setProfileError('');

    try {
      let nextProfile = await getCurrentUserProfile(session.user.id);

      if (!nextProfile) {
        nextProfile = await createPendingUserProfile(session.user);
      }

      setProfile(nextProfile);
      return nextProfile;
    } catch (err) {
      setProfile(null);
      setProfileError(err.message || 'Unable to load your access profile.');
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, [session]);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      if (!session?.user) {
        if (!active) return;
        setProfile(null);
        setProfileError('');
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      setProfileError('');

      try {
        let nextProfile = await getCurrentUserProfile(session.user.id);

        if (!nextProfile) {
          nextProfile = await createPendingUserProfile(session.user);
        }

        if (active) setProfile(nextProfile);
      } catch (err) {
        if (!active) return;
        setProfile(null);
        setProfileError(err.message || 'Unable to load your access profile.');
      } finally {
        if (active) setProfileLoading(false);
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [session?.user?.email, session?.user?.id]);

  const signInWithPassword = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async ({ email, password }) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const sendMagicLink = useCallback(async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setProfile(null);
    setProfileError('');
    await supabase.auth.signOut();
  }, []);

  return useMemo(
    () => ({
      isConfigured: isSupabaseConfigured,
      authError,
      loading: loading || profileLoading || Boolean(session && !profile && !profileError),
      profile,
      profileError,
      refreshProfile,
      sendMagicLink,
      session,
      signInWithGoogle,
      signInWithPassword,
      signOut,
      signUp,
      user: session?.user ?? null,
    }),
    [
      authError,
      loading,
      profile,
      profileError,
      profileLoading,
      refreshProfile,
      sendMagicLink,
      session,
      signInWithGoogle,
      signInWithPassword,
      signOut,
      signUp,
    ],
  );
}
