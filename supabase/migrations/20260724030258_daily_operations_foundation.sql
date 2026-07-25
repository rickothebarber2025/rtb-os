begin;

create table if not exists public.staff_shift_records (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete set null,
  shift_date date not null default current_date,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled','active','completed','missed')),
  late_minutes integer not null default 0,
  after_hours_minutes integer not null default 0,
  after_hours_reason text,
  correction_note text,
  corrected_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, business_unit_id, shift_date)
);

alter table public.staff_shift_records
  add column if not exists grace_minutes integer not null default 5 check (grace_minutes >= 0),
  add column if not exists break_minutes integer not null default 0 check (break_minutes >= 0),
  add column if not exists early_leave_minutes integer not null default 0 check (early_leave_minutes >= 0),
  add column if not exists overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  add column if not exists missed_shift boolean not null default false,
  add column if not exists missed_checkout boolean not null default false,
  add column if not exists edit_reason text,
  add column if not exists manager_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists manager_approved_at timestamptz;

create table if not exists public.operation_checklist_runs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete set null,
  run_date date not null default current_date,
  checklist_type text not null check (checklist_type in ('opening','closing')),
  status text not null default 'in_progress' check (status in ('in_progress','completed','overdue')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_unit_id, run_date, checklist_type)
);

alter table public.operation_checklist_runs
  add column if not exists template_id uuid,
  add column if not exists completion_percent integer not null default 0 check (completion_percent between 0 and 100),
  add column if not exists note text,
  add column if not exists manager_approved_by uuid references auth.users(id) on delete set null,
  add column if not exists manager_approved_at timestamptz;

create table if not exists public.operation_checklist_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.operation_checklist_runs(id) on delete cascade,
  position integer not null,
  label text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by_staff_id uuid references public.staff(id) on delete set null,
  photo_url text,
  note text,
  created_at timestamptz not null default now(),
  unique (run_id, position)
);

alter table public.operation_checklist_run_items
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.staff_operation_notifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete set null,
  notification_type text not null,
  title text not null,
  body text,
  idempotency_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_status_events (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  status text not null
    check (status in ('closed', 'opening', 'open', 'busy', 'closing', 'after_hours')),
  staff_id uuid references public.staff(id) on delete set null,
  note text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.operation_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete cascade,
  name text not null,
  checklist_type text not null check (checklist_type in ('opening', 'closing', 'daily', 'cleaning')),
  active boolean not null default true,
  requires_manager_approval boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operation_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.operation_checklist_templates(id) on delete cascade,
  label text not null,
  details text,
  sort_order integer not null default 0,
  requires_photo boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_operations_requests (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  request_type text not null check (request_type in ('maintenance', 'inventory', 'incident')),
  category text not null default 'general',
  title text not null,
  details text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'ordered', 'in_progress', 'received', 'completed', 'denied')),
  photo_urls jsonb not null default '[]'::jsonb,
  assigned_to uuid references auth.users(id) on delete set null,
  manager_note text,
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.policy_documents (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete cascade,
  title text not null,
  category text not null default 'policy'
    check (category in ('handbook', 'commission', 'cleaning', 'dress_code', 'late_policy', 'booking', 'social_media', 'safety', 'policy')),
  body text not null,
  version text not null default '1.0',
  requires_acknowledgement boolean not null default true,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.policy_acknowledgements (
  policy_id uuid not null references public.policy_documents(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (policy_id, staff_id)
);

create table if not exists public.shift_notes (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  shift_date date not null default current_date,
  note text not null,
  visibility text not null default 'team' check (visibility in ('team', 'manager')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.operations_audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete set null,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_shift_records_business_date_idx on public.staff_shift_records (business_unit_id, shift_date desc);
create index if not exists staff_shift_records_staff_date_idx on public.staff_shift_records (staff_id, shift_date desc);
create index if not exists operation_runs_business_date_idx on public.operation_checklist_runs (business_unit_id, run_date desc, checklist_type);
create index if not exists operation_items_run_idx on public.operation_checklist_run_items (run_id, position);
create index if not exists staff_operation_notifications_staff_idx on public.staff_operation_notifications (staff_id, read_at, created_at desc);
create index if not exists shop_status_events_business_created_idx on public.shop_status_events (business_unit_id, created_at desc);
create index if not exists operation_checklist_templates_business_type_idx on public.operation_checklist_templates (business_unit_id, checklist_type, active);
create index if not exists operation_checklist_items_template_idx on public.operation_checklist_items (template_id, sort_order);
create index if not exists staff_operations_requests_business_status_idx on public.staff_operations_requests (business_unit_id, request_type, status, created_at desc);
create index if not exists staff_operations_requests_staff_idx on public.staff_operations_requests (staff_id, created_at desc);
create index if not exists policy_documents_business_active_idx on public.policy_documents (business_unit_id, active, category);
create index if not exists policy_acknowledgements_staff_idx on public.policy_acknowledgements (staff_id);
create index if not exists shift_notes_business_date_idx on public.shift_notes (business_unit_id, shift_date desc);
create index if not exists operations_audit_logs_record_idx on public.operations_audit_logs (table_name, record_id, created_at desc);

with seeded_opening_templates as (
  insert into public.operation_checklist_templates (business_unit_id, checklist_type, name)
  select b.id, 'opening', 'Opening checklist'
  from public.business_units b
  where not exists (
    select 1 from public.operation_checklist_templates existing
    where existing.business_unit_id = b.id
      and existing.checklist_type = 'opening'
      and existing.active = true
  )
  returning id
)
insert into public.operation_checklist_items (template_id, label, sort_order, requires_photo)
select template.id, item.label, item.sort_order, item.requires_photo
from seeded_opening_templates template
cross join (
  values
    ('Unlock doors and check entrance', 10, false),
    ('Turn on lights, music, and waiting area', 20, false),
    ('Turn on POS and confirm appointments', 30, false),
    ('Restock towels and shared supplies', 40, false),
    ('Sanitize waiting area, stations, and washroom', 50, true)
) as item(label, sort_order, requires_photo);

with seeded_closing_templates as (
  insert into public.operation_checklist_templates (business_unit_id, checklist_type, name)
  select b.id, 'closing', 'Closing checklist'
  from public.business_units b
  where not exists (
    select 1 from public.operation_checklist_templates existing
    where existing.business_unit_id = b.id
      and existing.checklist_type = 'closing'
      and existing.active = true
  )
  returning id
)
insert into public.operation_checklist_items (template_id, label, sort_order, requires_photo)
select template.id, item.label, item.sort_order, item.requires_photo
from seeded_closing_templates template
cross join (
  values
    ('Sweep floors and clear stations', 10, true),
    ('Take out garbage and start laundry', 20, false),
    ('Restock products and towels', 30, false),
    ('Close POS and note any cash issues', 40, false),
    ('Turn off lights and lock doors', 50, true)
) as item(label, sort_order, requires_photo);

alter table public.staff_shift_records enable row level security;
alter table public.operation_checklist_runs enable row level security;
alter table public.operation_checklist_run_items enable row level security;
alter table public.staff_operation_notifications enable row level security;
alter table public.shop_status_events enable row level security;
alter table public.operation_checklist_templates enable row level security;
alter table public.operation_checklist_items enable row level security;
alter table public.staff_operations_requests enable row level security;
alter table public.policy_documents enable row level security;
alter table public.policy_acknowledgements enable row level security;
alter table public.shift_notes enable row level security;
alter table public.operations_audit_logs enable row level security;

grant select, insert, update on public.staff_shift_records to authenticated;
grant select, insert, update on public.operation_checklist_runs to authenticated;
grant select, insert, update on public.operation_checklist_run_items to authenticated;
grant select, update on public.staff_operation_notifications to authenticated;
grant select, insert, update, delete on public.shop_status_events to authenticated;
grant select, insert, update, delete on public.operation_checklist_templates to authenticated;
grant select, insert, update, delete on public.operation_checklist_items to authenticated;
grant select, insert, update, delete on public.staff_operations_requests to authenticated;
grant select, insert, update, delete on public.policy_documents to authenticated;
grant select, insert, update, delete on public.policy_acknowledgements to authenticated;
grant select, insert, update, delete on public.shift_notes to authenticated;
grant select on public.operations_audit_logs to authenticated;

create or replace function private.checklist_run_business_unit_id(p_run_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select business_unit_id
  from public.operation_checklist_runs
  where id = p_run_id
  limit 1;
$function$;

create or replace function private.checklist_item_business_unit_id(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select t.business_unit_id
  from public.operation_checklist_items i
  join public.operation_checklist_templates t on t.id = i.template_id
  where i.id = p_item_id
  limit 1;
$function$;

create or replace function private.checklist_template_business_unit_id(p_template_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select business_unit_id
  from public.operation_checklist_templates
  where id = p_template_id
  limit 1;
$function$;

create or replace function private.policy_business_unit_id(p_policy_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select business_unit_id
  from public.policy_documents
  where id = p_policy_id
  limit 1;
$function$;

grant execute on function private.checklist_run_business_unit_id(uuid) to authenticated;
grant execute on function private.checklist_item_business_unit_id(uuid) to authenticated;
grant execute on function private.checklist_template_business_unit_id(uuid) to authenticated;
grant execute on function private.policy_business_unit_id(uuid) to authenticated;

create or replace function private.log_operations_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_business_unit_id uuid;
  v_record_id uuid;
begin
  v_record_id := coalesce(new.id, old.id);
  v_business_unit_id := coalesce(new.business_unit_id, old.business_unit_id);

  insert into public.operations_audit_logs (
    action,
    actor_id,
    after_data,
    before_data,
    business_unit_id,
    record_id,
    table_name
  )
  values (
    lower(tg_op),
    auth.uid(),
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    v_business_unit_id,
    v_record_id,
    tg_table_name
  );

  return coalesce(new, old);
end;
$function$;

revoke all on function private.log_operations_change() from public;
grant execute on function private.log_operations_change() to authenticated;

drop trigger if exists staff_shift_records_audit on public.staff_shift_records;
create trigger staff_shift_records_audit
after insert or update or delete on public.staff_shift_records
for each row execute function private.log_operations_change();

drop trigger if exists operation_checklist_runs_audit on public.operation_checklist_runs;
create trigger operation_checklist_runs_audit
after insert or update or delete on public.operation_checklist_runs
for each row execute function private.log_operations_change();

drop trigger if exists staff_operations_requests_audit on public.staff_operations_requests;
create trigger staff_operations_requests_audit
after insert or update or delete on public.staff_operations_requests
for each row execute function private.log_operations_change();

drop trigger if exists policy_documents_audit on public.policy_documents;
create trigger policy_documents_audit
after insert or update or delete on public.policy_documents
for each row execute function private.log_operations_change();

drop policy if exists shop_status_events_select on public.shop_status_events;
drop policy if exists shop_status_events_insert on public.shop_status_events;
drop policy if exists shop_status_events_update on public.shop_status_events;
drop policy if exists shop_status_events_delete on public.shop_status_events;
create policy shop_status_events_select on public.shop_status_events
for select to authenticated
using (private.staff_hub_business_view(business_unit_id));
create policy shop_status_events_insert on public.shop_status_events
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy shop_status_events_update on public.shop_status_events
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy shop_status_events_delete on public.shop_status_events
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists checklist_templates_select on public.operation_checklist_templates;
drop policy if exists checklist_templates_insert on public.operation_checklist_templates;
drop policy if exists checklist_templates_update on public.operation_checklist_templates;
drop policy if exists checklist_templates_delete on public.operation_checklist_templates;
create policy checklist_templates_select on public.operation_checklist_templates
for select to authenticated
using (private.staff_hub_business_view(business_unit_id));
create policy checklist_templates_insert on public.operation_checklist_templates
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy checklist_templates_update on public.operation_checklist_templates
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy checklist_templates_delete on public.operation_checklist_templates
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists checklist_items_select on public.operation_checklist_items;
drop policy if exists checklist_items_insert on public.operation_checklist_items;
drop policy if exists checklist_items_update on public.operation_checklist_items;
drop policy if exists checklist_items_delete on public.operation_checklist_items;
create policy checklist_items_select on public.operation_checklist_items
for select to authenticated
using (private.staff_hub_business_view(private.checklist_item_business_unit_id(id)));
create policy checklist_items_insert on public.operation_checklist_items
for insert to authenticated
with check (private.staff_hub_business_admin(private.checklist_template_business_unit_id(template_id), 'edit'));
create policy checklist_items_update on public.operation_checklist_items
for update to authenticated
using (private.staff_hub_business_admin(private.checklist_item_business_unit_id(id), 'edit'))
with check (private.staff_hub_business_admin(private.checklist_template_business_unit_id(template_id), 'edit'));
create policy checklist_items_delete on public.operation_checklist_items
for delete to authenticated
using (private.staff_hub_business_admin(private.checklist_item_business_unit_id(id), 'admin'));

drop policy if exists operations_requests_select on public.staff_operations_requests;
drop policy if exists operations_requests_insert on public.staff_operations_requests;
drop policy if exists operations_requests_update on public.staff_operations_requests;
drop policy if exists operations_requests_delete on public.staff_operations_requests;
create policy operations_requests_select on public.staff_operations_requests
for select to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'view'));
create policy operations_requests_insert on public.staff_operations_requests
for insert to authenticated
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy operations_requests_update on public.staff_operations_requests
for update to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy operations_requests_delete on public.staff_operations_requests
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists policy_documents_select on public.policy_documents;
drop policy if exists policy_documents_insert on public.policy_documents;
drop policy if exists policy_documents_update on public.policy_documents;
drop policy if exists policy_documents_delete on public.policy_documents;
create policy policy_documents_select on public.policy_documents
for select to authenticated
using (
  (active and private.staff_hub_business_view(business_unit_id))
  or private.staff_hub_business_admin(business_unit_id, 'view')
);
create policy policy_documents_insert on public.policy_documents
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy policy_documents_update on public.policy_documents
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy policy_documents_delete on public.policy_documents
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists policy_acknowledgements_select on public.policy_acknowledgements;
drop policy if exists policy_acknowledgements_insert on public.policy_acknowledgements;
drop policy if exists policy_acknowledgements_update on public.policy_acknowledgements;
drop policy if exists policy_acknowledgements_delete on public.policy_acknowledgements;
create policy policy_acknowledgements_select on public.policy_acknowledgements
for select to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(private.policy_business_unit_id(policy_id), 'view'));
create policy policy_acknowledgements_insert on public.policy_acknowledgements
for insert to authenticated
with check (staff_id = private.current_staff_id());
create policy policy_acknowledgements_update on public.policy_acknowledgements
for update to authenticated
using (staff_id = private.current_staff_id())
with check (staff_id = private.current_staff_id());
create policy policy_acknowledgements_delete on public.policy_acknowledgements
for delete to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(private.policy_business_unit_id(policy_id), 'admin'));

drop policy if exists shift_notes_select on public.shift_notes;
drop policy if exists shift_notes_insert on public.shift_notes;
drop policy if exists shift_notes_update on public.shift_notes;
drop policy if exists shift_notes_delete on public.shift_notes;
create policy shift_notes_select on public.shift_notes
for select to authenticated
using (
  (visibility = 'team' and private.staff_hub_business_view(business_unit_id))
  or private.staff_hub_business_admin(business_unit_id, 'view')
  or staff_id = private.current_staff_id()
);
create policy shift_notes_insert on public.shift_notes
for insert to authenticated
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy shift_notes_update on public.shift_notes
for update to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy shift_notes_delete on public.shift_notes
for delete to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists operations_audit_logs_select on public.operations_audit_logs;
create policy operations_audit_logs_select on public.operations_audit_logs
for select to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

commit;
