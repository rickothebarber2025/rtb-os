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
- `calculate_staff_take_home()`
- `lock_payroll_run()`
- `save_performance_from_run()`

## Appointment data

RTB Lounge uses Booksy data. Booksy does not expose the same public OAuth API surface
as Square, so RTB OS currently expects Booksy reports to be imported into
`app_settings.rtb_master_dashboard`.

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
supabase secrets set SQUARE_APPLICATION_ID=your_square_application_id
supabase secrets set SQUARE_APPLICATION_SECRET=your_square_application_secret
supabase secrets set SQUARE_REDIRECT_URL=https://qbeficojfoqgzjxrzxyg.supabase.co/functions/v1/square-oauth-callback
```

Register the same redirect URL in the Square Developer Console for the production
application. After that, open RTB Beauty Lounge in RTB OS, go to Appointment
Insights, choose Connect Square, approve access, then run Sync Square.
