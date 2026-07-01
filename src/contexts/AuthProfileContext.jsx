import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const AuthProfileContext = createContext(null);

export function AuthProfileProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const setAuthProfileState = useCallback((nextProfile, nextLoading = false) => {
    setProfile(nextProfile);
    setLoading(nextLoading);
  }, []);

  const value = useMemo(
    () => ({
      loading,
      profile,
      setAuthProfileState,
    }),
    [loading, profile, setAuthProfileState],
  );

  return <AuthProfileContext.Provider value={value}>{children}</AuthProfileContext.Provider>;
}

export function useAuthProfile() {
  const context = useContext(AuthProfileContext);
  if (!context) {
    throw new Error('useAuthProfile must be used inside AuthProfileProvider.');
  }
  return context;
}

export function useSyncAuthProfile(profile, loading = false) {
  const { setAuthProfileState } = useAuthProfile();

  useEffect(() => {
    setAuthProfileState(profile || null, loading);
  }, [loading, profile, setAuthProfileState]);
}
