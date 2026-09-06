begin;

create table if not exists public.ada_communication_cases (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  contact_name text not null,
  case_key text not null,
  category text not null default 'general'
    check (category in (
      'attendance','availability','time_off','supplies','cash','payroll','client','policy',
      'maintenance','opportunity','follow_up','coverage','general'
    )),
  title text not null,
  summary text,
  next_action text,
  action_type text not null default 'task'
    check (action_type in (
      'task','reply','calendar','schedule_update','time_off_review','purchase_request',
      'coverage_review','policy_decision','cash_review','payroll_review','maintenance_follow_up',
      'business_follow_up','none'
    )),
  execution_mode text not null default 'owner_action'
    check (execution_mode in ('automatic_capture','approval_required','owner_action','no_action')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  status text not null default 'open'
    check (status in ('open','waiting_approval','in_progress','resolved','ignored')),
  approval_required boolean not null default false,
  due_hint text,
  confidence_score numeric(4,3)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  source_count integer not null default 1 check (source_count >= 1),
  extracted_data jsonb not null default '{}'::jsonb,
  first_message_at timestamptz,
  last_message_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ada_communication_messages (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  case_id uuid references public.ada_communication_cases(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  source text not null default 'imessage'
    check (source in ('imessage','sms','shortcut','mac_messages','manual','other')),
  direction text not null default 'incoming'
    check (direction in ('incoming','outgoing')),
  sender_name text not null,
  sender_handle text,
  conversation_id text,
  external_message_id text,
  body text not null,
  message_at timestamptz not null default now(),
  classification text,
  priority text check (priority is null or priority in ('low','normal','high','urgent')),
  requires_action boolean not null default false,
  requires_reply boolean not null default false,
  confidence_score numeric(4,3)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  extracted_data jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ada_comm_cases_business_status_idx
  on public.ada_communication_cases (business_unit_id, status, priority, last_message_at desc);
create index if not exists ada_comm_cases_staff_status_idx
  on public.ada_communication_cases (staff_id, status, last_message_at desc);
create index if not exists ada_comm_cases_group_idx
  on public.ada_communication_cases (business_unit_id, staff_id, case_key, status);
create index if not exists ada_comm_messages_business_date_idx
  on public.ada_communication_messages (business_unit_id, message_at desc);
create index if not exists ada_comm_messages_case_idx
  on public.ada_communication_messages (case_id, message_at asc);
create unique index if not exists ada_comm_messages_external_unique_idx
  on public.ada_communication_messages (source, external_message_id)
  where external_message_id is not null;

alter table public.ada_communication_cases enable row level security;
alter table public.ada_communication_messages enable row level security;

grant select, insert, update on public.ada_communication_cases to authenticated;
grant select, insert, update on public.ada_communication_messages to authenticated;

-- Communications can include private owner/staff messages. Keep them manager-only.
drop policy if exists ada_comm_cases_select on public.ada_communication_cases;
drop policy if exists ada_comm_cases_insert on public.ada_communication_cases;
drop policy if exists ada_comm_cases_update on public.ada_communication_cases;
create policy ada_comm_cases_select on public.ada_communication_cases
for select to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'view'));
create policy ada_comm_cases_insert on public.ada_communication_cases
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy ada_comm_cases_update on public.ada_communication_cases
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

drop policy if exists ada_comm_messages_select on public.ada_communication_messages;
drop policy if exists ada_comm_messages_insert on public.ada_communication_messages;
drop policy if exists ada_comm_messages_update on public.ada_communication_messages;
create policy ada_comm_messages_select on public.ada_communication_messages
for select to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'view'));
create policy ada_comm_messages_insert on public.ada_communication_messages
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy ada_comm_messages_update on public.ada_communication_messages
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

-- Reuse the existing operations audit trail for case changes, but not raw message bodies.
drop trigger if exists ada_communication_cases_audit on public.ada_communication_cases;
create trigger ada_communication_cases_audit
after insert or update on public.ada_communication_cases
for each row execute function private.log_operations_change();

commit;