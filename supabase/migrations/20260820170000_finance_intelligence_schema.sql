begin;

create table if not exists public.finance_reconciliations (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  bank_transaction_id uuid not null references public.finance_transactions(id) on delete cascade,
  match_type text not null check (match_type in ('payroll_entry','payroll_run','obligation','square_deposit','other')),
  matched_id uuid,
  match_label text not null,
  expected_amount numeric(12,2) not null,
  actual_amount numeric(12,2) not null,
  confidence integer not null check (confidence between 0 and 100),
  status text not null default 'suggested' check (status in ('suggested','confirmed','rejected')),
  reason jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_transaction_id, match_type, matched_id)
);

create table if not exists public.finance_recurring_patterns (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  merchant_key text not null,
  label text not null,
  direction text not null check (direction in ('income','expense')),
  avg_amount numeric(12,2) not null,
  amount_variance numeric(12,2) not null default 0,
  cadence text not null check (cadence in ('weekly','biweekly','monthly','quarterly','yearly','irregular')),
  interval_days integer not null default 30,
  occurrence_count integer not null default 0,
  last_seen_date date,
  next_expected_date date,
  confidence integer not null default 0 check (confidence between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_unit_id, merchant_key, direction)
);

create table if not exists public.finance_calendar_events (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  event_date date not null,
  event_type text not null,
  label text not null,
  direction text not null check (direction in ('income','expense')),
  expected_amount numeric(12,2) not null,
  status text not null default 'predicted' check (status in ('predicted','scheduled','confirmed','overdue','cancelled')),
  confidence integer not null default 0 check (confidence between 0 and 100),
  source_type text not null,
  source_id uuid,
  linked_transaction_id uuid references public.finance_transactions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.finance_calendar_events drop constraint if exists finance_calendar_events_event_type_check;
alter table public.finance_calendar_events add constraint finance_calendar_events_event_type_check
  check (event_type in ('obligation','payroll','recurring_expense','recurring_income','square_deposit','sales','tax','other'));

create table if not exists public.finance_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  horizon_days integer not null check (horizon_days in (7,30,60,90)),
  expected_in numeric(12,2) not null default 0,
  expected_out numeric(12,2) not null default 0,
  expected_net numeric(12,2) not null default 0,
  confirmed_in numeric(12,2) not null default 0,
  confirmed_out numeric(12,2) not null default 0,
  risk_level text not null default 'normal' check (risk_level in ('normal','watch','high')),
  details jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now()
);

create unique index if not exists finance_calendar_source_date_uidx on public.finance_calendar_events (business_unit_id,source_type,source_id,event_date) where source_id is not null;
create index if not exists finance_reconciliations_business_status_idx on public.finance_reconciliations (business_unit_id,status,confidence desc);
create index if not exists finance_patterns_business_next_idx on public.finance_recurring_patterns (business_unit_id,next_expected_date) where active;
create index if not exists finance_calendar_business_date_idx on public.finance_calendar_events (business_unit_id,event_date,status);
create index if not exists finance_forecast_business_generated_idx on public.finance_forecast_snapshots (business_unit_id,generated_at desc);

alter table public.finance_reconciliations enable row level security;
alter table public.finance_recurring_patterns enable row level security;
alter table public.finance_calendar_events enable row level security;
alter table public.finance_forecast_snapshots enable row level security;

drop policy if exists finance_reconciliations_select on public.finance_reconciliations;
create policy finance_reconciliations_select on public.finance_reconciliations for select to authenticated using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view') and private.finance_business_allowed(business_unit_id));
drop policy if exists finance_reconciliations_update on public.finance_reconciliations;
create policy finance_reconciliations_update on public.finance_reconciliations for update to authenticated using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit') and private.finance_business_allowed(business_unit_id)) with check (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit') and private.finance_business_allowed(business_unit_id));
drop policy if exists finance_patterns_select on public.finance_recurring_patterns;
create policy finance_patterns_select on public.finance_recurring_patterns for select to authenticated using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view') and private.finance_business_allowed(business_unit_id));
drop policy if exists finance_calendar_select on public.finance_calendar_events;
create policy finance_calendar_select on public.finance_calendar_events for select to authenticated using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view') and private.finance_business_allowed(business_unit_id));
drop policy if exists finance_forecast_select on public.finance_forecast_snapshots;
create policy finance_forecast_select on public.finance_forecast_snapshots for select to authenticated using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view') and private.finance_business_allowed(business_unit_id));

revoke all on public.finance_reconciliations,public.finance_recurring_patterns,public.finance_calendar_events,public.finance_forecast_snapshots from anon;
grant select,update on public.finance_reconciliations to authenticated;
grant select on public.finance_recurring_patterns,public.finance_calendar_events,public.finance_forecast_snapshots to authenticated;

commit;
