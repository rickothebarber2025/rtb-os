create table if not exists public.textnow_messages (
  source_key text primary key,
  message_id text,
  number text not null,
  content text not null default '',
  message_date timestamptz,
  is_read boolean not null default false,
  direction text not null default '',
  first_contact boolean not null default false,
  message_type text not null default '',
  content_type text,
  synced_at timestamptz not null default now()
);

create index if not exists textnow_messages_number_date_idx
  on public.textnow_messages (number, message_date desc);

create index if not exists textnow_messages_date_idx
  on public.textnow_messages (message_date desc);

alter table public.textnow_messages enable row level security;

create table if not exists public.textnow_outbox (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  message text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts integer not null default 0,
  last_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists textnow_outbox_status_created_idx
  on public.textnow_outbox (status, created_at);

alter table public.textnow_outbox enable row level security;

create table if not exists public.textnow_sync_state (
  id text primary key,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  messages_seen integer not null default 0,
  outbox_sent integer not null default 0,
  outbox_failed integer not null default 0
);

alter table public.textnow_sync_state enable row level security;
