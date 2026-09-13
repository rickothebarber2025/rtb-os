import { createClient } from '@supabase/supabase-js';
import { processLock } from '@supabase/auth-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// WKWebView can stall on navigator.locks. A process-local lock is sufficient
// because RTB OS runs one authenticated JS context per native app instance.
//
// PKCE is required here so OAuth can leave the app in the system browser and
// safely return an authorization code through the registered custom URL scheme.
// The verifier remains in this app's persisted auth storage and is exchanged
// only after Capacitor hands the deep link back to useAuth().
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        persistSession: true,
        lock: processLock,
      },
    })
  : null;
