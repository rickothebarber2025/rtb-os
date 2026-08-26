import { useCallback, useEffect, useMemo, useState } from 'react';

export const DEFAULT_USER_PREFERENCES = {
  density: 'compact',
  displayName: '',
  navigationStyle: 'simple',
  reduceMotion: false,
  themePreference: 'auto',
};

const STORAGE_PREFIX = 'rtb-os-user-preferences-v1';
const VALID_DENSITIES = new Set(['comfortable', 'compact']);
const VALID_NAVIGATION_STYLES = new Set(['simple', 'full']);
const VALID_THEME_PREFERENCES = new Set(['auto', 'beauty', 'lounge', 'combined']);

function storageKey(userId) {
  return `${STORAGE_PREFIX}:${userId || 'local'}`;
}

export function normalizeUserPreferences(value) {
  const preferences = value && typeof value === 'object' ? value : {};

  return {
    density: VALID_DENSITIES.has(preferences.density)
      ? preferences.density
      : DEFAULT_USER_PREFERENCES.density,
    displayName:
      typeof preferences.displayName === 'string'
        ? preferences.displayName.trim().slice(0, 48)
        : DEFAULT_USER_PREFERENCES.displayName,
    navigationStyle: VALID_NAVIGATION_STYLES.has(preferences.navigationStyle)
      ? preferences.navigationStyle
      : DEFAULT_USER_PREFERENCES.navigationStyle,
    reduceMotion: Boolean(preferences.reduceMotion),
    themePreference: VALID_THEME_PREFERENCES.has(preferences.themePreference)
      ? preferences.themePreference
      : DEFAULT_USER_PREFERENCES.themePreference,
  };
}

function readPreferences(key) {
  if (typeof window === 'undefined') return DEFAULT_USER_PREFERENCES;

  try {
    return normalizeUserPreferences(JSON.parse(window.localStorage.getItem(key) || '{}'));
  } catch (_err) {
    return DEFAULT_USER_PREFERENCES;
  }
}

export function useUserPreferences(userId) {
  const key = useMemo(() => storageKey(userId), [userId]);
  const [preferences, setPreferencesState] = useState(() => readPreferences(key));

  useEffect(() => {
    setPreferencesState(readPreferences(key));
  }, [key]);

  const setUserPreferences = useCallback(
    (nextPreferences) => {
      setPreferencesState((currentPreferences) => {
        const resolved =
          typeof nextPreferences === 'function'
            ? nextPreferences(currentPreferences)
            : nextPreferences;
        const normalized = normalizeUserPreferences(resolved);

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(normalized));
        }

        return normalized;
      });
    },
    [key],
  );

  return [preferences, setUserPreferences];
}
