import { useCallback, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import {
  createPendingUserProfile,
  getCurrentUserProfile,
} from '../services/rtbService';

export function useAuth() {
  const [session, setSession] = useState(null);
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

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
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
