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
