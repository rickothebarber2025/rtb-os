begin;

-- public.integration_connections and public.integration_oauth_states existed in
-- production before migrations were tracked here (see square-appointments and
-- square-oauth-callback edge functions, which are the only readers/writers).
-- 20260618062453_payroll_probation_followup.sql indexes both tables, which
-- requires them to already exist, so a fresh database needs them created first.

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  status text not null default 'connected',
  access_token text,
  refresh_token text,
  token_type text,
  merchant_id text,
  scopes text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, business_unit_id)
);

create table if not exists public.integration_oauth_states (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  state text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- These tables hold live OAuth secrets and are only ever read or written by
-- Edge Functions using the service-role client, which bypasses RLS. Enable
-- RLS with no policies so anon/authenticated requests get nothing.
alter table public.integration_connections enable row level security;
alter table public.integration_oauth_states enable row level security;

commit;
