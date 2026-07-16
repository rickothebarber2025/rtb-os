# RTB OS

React, Vite, and Supabase business dashboard for RTB Lounge and RTB Beauty Lounge.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_ANON_KEY` in `.env.local` or in the host environment. Do not commit real keys.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm test
```

## Supabase

The app expects the existing Supabase tables and RPC functions:

- `business_units`
- `staff`
- `payroll_runs`
- `payroll_entries`
- `booth_rent`
- `performance_history`
- `app_settings`
- `staff_performance_summary`
- `staff_monthly_performance_summary`
- `calculate_staff_take_home()`
- `save_payroll_draft()`
- `lock_payroll_run()`
- `save_performance_from_run()`

Database changes are versioned in `supabase/migrations`. Apply pending migrations before
publishing a frontend that depends on new columns, views, or RPC functions.

## Appointment data

RTB Lounge uses Booksy data. Booksy does not expose the same public OAuth API surface
as Square, so RTB OS currently expects Booksy reports to be imported into
`app_settings.rtb_master_dashboard`.

Booksy Gmail ingestion reads Gmail messages that carry the dedicated label
`RTB-OS/Booksy`. The Gmail sync runs inside a Supabase Edge Function, so Google
credentials must be set as Supabase secrets, not Vite or browser variables.

Preferred production setup uses a Google OAuth refresh token:

```bash
supabase secrets set --project-ref qbeficojfoqgzjxrzxyg \
  GOOGLE_GMAIL_CLIENT_ID=your_google_oauth_client_id \
  GOOGLE_GMAIL_CLIENT_SECRET=your_google_oauth_client_secret \
  GOOGLE_GMAIL_REFRESH_TOKEN=your_google_oauth_refresh_token \
  BOOKSY_GMAIL_LABEL="RTB-OS/Booksy" \
  BOOKSY_GMAIL_USER=me
```

A short-lived access token can unblock testing, but it will expire and should not
be used as the permanent setup:

```bash
supabase secrets set --project-ref qbeficojfoqgzjxrzxyg \
  GOOGLE_GMAIL_ACCESS_TOKEN=your_short_lived_google_access_token
```

After setting secrets, apply the `RTB-OS/Booksy` Gmail label to Booksy emails and
run the Booksy Gmail sync from Customer IQ.

RTB Beauty Lounge uses Square Appointments. Square secrets must be stored as
Supabase Edge Function secrets, never in React code.

For the owner's Square account, the simplest production setup is the Square
Production Access Token:

```bash
supabase secrets set SQUARE_ACCESS_TOKEN=your_square_production_access_token
```

RTB OS limits Square sync by default to 4 syncs per day, 6 hours apart, with a
maximum of 500 bookings per sync. These can be tuned with:

```bash
supabase secrets set SQUARE_SYNC_DAILY_LIMIT=4
supabase secrets set SQUARE_SYNC_MIN_INTERVAL_MINUTES=360
supabase secrets set SQUARE_SYNC_MAX_BOOKINGS=500
```

For OAuth instead, add the Square app credentials:

```bash
supabase secrets set RTB_OS_PUBLIC_URL=https://rtbheadquaters.com APP_URL=https://rtbheadquaters.com/
supabase secrets set SQUARE_APPLICATION_ID=your_square_application_id
supabase secrets set SQUARE_APPLICATION_SECRET=your_square_application_secret
supabase secrets set SQUARE_REDIRECT_URL=https://qbeficojfoqgzjxrzxyg.supabase.co/functions/v1/square-oauth-callback
```

Register the same redirect URL in the Square Developer Console for the production
application. After that, open RTB Beauty Lounge in RTB OS, go to Appointment
Insights, choose Connect Square, approve access, then run Sync Square.

Rotate any Square token or application secret that was previously pasted into chat,
logs, tickets, or source code before enabling production sync.
