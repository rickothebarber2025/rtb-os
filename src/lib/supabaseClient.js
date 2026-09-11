import { createClient } from '@supabase/supabase-js';
import { processLock } from '@supabase/auth-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// supabase-js defaults to `navigatorLock`, which serializes auth calls
// (getSession/refresh/etc.) through the browser's Web Locks API so multiple
// tabs don't race each other. Inside a single Capacitor WKWebView instance
// (iOS/iPadOS) that coordination is unnecessary, and on some iPadOS builds
// `navigator.locks.request()` never invokes its callback at all -- the lock
// is requested but nothing acquires it, so every auth call that goes through
// it (including the very first `getSession()` on app launch) hangs forever.
// Since useAuth() gates the entire app -- including the login screen itself
// -- behind that first call resolving, the whole app is stuck on a loading
// spinner with no way to reach the sign-in form. This is what Apple's
// reviewer saw on an iPad Air (M3): "Page loaded indefinitely when we tried
// to log in."
//
// `processLock` is an in-memory mutex (no Web Locks API involved) that
// still serializes concurrent auth calls within this one JS context, which
// is all a single WKWebView instance or a single browser tab ever needs.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        lock: processLock,
      },
    })
  : null;
