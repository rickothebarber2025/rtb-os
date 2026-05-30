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
Supabase Edge Function secrets, never in React code:

```bash
supabase secrets set SQUARE_APPLICATION_ID=your_square_application_id
supabase secrets set SQUARE_APPLICATION_SECRET=your_square_application_secret
supabase secrets set SQUARE_REDIRECT_URL=https://qbeficojfoqgzjxrzxyg.supabase.co/functions/v1/square-oauth-callback
```

Register the same redirect URL in the Square Developer Console for the production
application. After that, open RTB Beauty Lounge in RTB OS, go to Appointment
Insights, choose Connect Square, approve access, then run Sync Square.
