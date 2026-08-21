# RTB OS Release Channels

RTB OS uses one stable source of truth: `main`.

## Channels

- **Web:** production frontend is built from `main` and must pass `Validate RTB OS`.
- **iOS:** Capacitor/Xcode validation now runs for relevant `main` changes so the native shell stays aligned with the same web assets.
- **Supabase:** database, auth, Edge Functions, realtime, storage and migrations remain the live backend. Database changes must be represented in `supabase/migrations` and applied to production before dependent frontend changes are considered complete.
- **GitHub feature branches:** development only. They are not release channels and must not be force-synced with `main` because they can contain unfinished work.
- **gh-pages:** legacy/stale deployment branch. Do not treat it as production unless the repository hosting configuration is intentionally moved back to GitHub Pages.

## Release rule

A change is considered ready only after:

1. `Validate RTB OS` passes.
2. iOS validation passes when the change affects frontend/native assets.
3. Required Supabase migrations/functions are live.
4. Production client errors are checked after rollout.
