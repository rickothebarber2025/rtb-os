begin;

alter table public.integration_connections
  alter column business_unit_id drop not null;

alter table public.integration_oauth_states
  alter column business_unit_id drop not null;

alter table public.integration_connections
  add column if not exists connection_type text not null default 'oauth';

alter table public.integration_connections
  add column if not exists last_checked_at timestamptz;

create unique index if not exists integration_connections_provider_global_uidx
  on public.integration_connections (provider)
  where business_unit_id is null;

create index if not exists integration_connections_status_idx
  on public.integration_connections (status, updated_at desc);

commit;
