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

create index if not exists staff_shift_records_staff_date_idx
  on public.staff_shift_records (staff_id, shift_date desc);
create index if not exists operation_runs_business_date_idx
  on public.operation_checklist_runs (business_unit_id, run_date desc, checklist_type);
create index if not exists operation_items_run_idx
  on public.operation_checklist_run_items (run_id, position);
create index if not exists staff_operation_notifications_staff_idx
  on public.staff_operation_notifications (staff_id, read_at, created_at desc);

alter table public.staff_shift_records enable row level security;
alter table public.operation_checklist_runs enable row level security;
alter table public.operation_checklist_run_items enable row level security;
alter table public.staff_operation_notifications enable row level security;

grant select, insert, update on public.staff_shift_records to authenticated;
grant select, insert, update on public.operation_checklist_runs to authenticated;
grant select, insert, update on public.operation_checklist_run_items to authenticated;
grant select, update on public.staff_operation_notifications to authenticated;

drop policy if exists staff_shift_records_access on public.staff_shift_records;
create policy staff_shift_records_access on public.staff_shift_records
for all to authenticated
using (
  staff_id = private.current_staff_id()
  or private.staff_hub_business_admin(business_unit_id, 'view')
)
with check (
  staff_id = private.current_staff_id()
  or private.staff_hub_business_admin(business_unit_id, 'edit')
);

drop policy if exists operation_runs_access on public.operation_checklist_runs;
create policy operation_runs_access on public.operation_checklist_runs
for all to authenticated
using (
  staff_id = private.current_staff_id()
  or private.staff_hub_business_admin(business_unit_id, 'view')
)
with check (
  staff_id = private.current_staff_id()
  or private.staff_hub_business_admin(business_unit_id, 'edit')
);

drop policy if exists operation_items_access on public.operation_checklist_run_items;
create policy operation_items_access on public.operation_checklist_run_items
for all to authenticated
using (
  exists (
    select 1 from public.operation_checklist_runs r
    where r.id = operation_checklist_run_items.run_id
      and (
        r.staff_id = private.current_staff_id()
        or private.staff_hub_business_admin(r.business_unit_id, 'view')
      )
  )
)
with check (
  exists (
    select 1 from public.operation_checklist_runs r
    where r.id = operation_checklist_run_items.run_id
      and (
        r.staff_id = private.current_staff_id()
        or private.staff_hub_business_admin(r.business_unit_id, 'edit')
      )
  )
);

drop policy if exists operation_notifications_access on public.staff_operation_notifications;
create policy operation_notifications_access on public.staff_operation_notifications
for select to authenticated
using (
  staff_id = private.current_staff_id()
  or private.staff_hub_business_admin(business_unit_id, 'view')
);

drop policy if exists operation_notifications_update on public.staff_operation_notifications;
create policy operation_notifications_update on public.staff_operation_notifications
for update to authenticated
using (staff_id = private.current_staff_id())
with check (staff_id = private.current_staff_id());

create or replace function public.get_my_daily_operations(p_business_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_shift public.staff_shift_records;
  v_runs jsonb;
  v_notifications jsonb;
begin
  if v_staff_id is null then
    raise exception 'No staff profile is linked to this account.';
  end if;

  select * into v_shift
  from public.staff_shift_records
  where staff_id = v_staff_id
    and business_unit_id is not distinct from p_business_unit_id
    and shift_date = current_date;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'type', r.checklist_type,
      'status', r.status,
      'started_at', r.started_at,
      'completed_at', r.completed_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id,
          'position', i.position,
          'label', i.label,
          'completed', i.completed,
          'completed_at', i.completed_at,
          'photo_url', i.photo_url,
          'note', i.note
        ) order by i.position)
        from public.operation_checklist_run_items i
        where i.run_id = r.id
      ), '[]'::jsonb)
    ) order by r.checklist_type
  ), '[]'::jsonb)
  into v_runs
  from public.operation_checklist_runs r
  where r.run_date = current_date
    and r.business_unit_id is not distinct from p_business_unit_id
    and (r.staff_id = v_staff_id or private.staff_hub_business_admin(r.business_unit_id, 'view'));

  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
  into v_notifications
  from public.staff_operation_notifications n
  where n.staff_id = v_staff_id
    and n.business_unit_id is not distinct from p_business_unit_id
    and n.created_at >= current_date - interval '7 days';

  return jsonb_build_object(
    'staff_id', v_staff_id,
    'shift', case when v_shift.id is null then null else to_jsonb(v_shift) end,
    'checklists', v_runs,
    'notifications', v_notifications
  );
end;
$function$;

create or replace function public.start_my_shift(p_business_unit_id uuid, p_grace_minutes integer default 10)
returns public.staff_shift_records
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_row public.staff_shift_records;
  v_late integer := 0;
begin
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;

  select * into v_row from public.staff_shift_records
  where staff_id = v_staff_id
    and business_unit_id is not distinct from p_business_unit_id
    and shift_date = current_date;

  if v_row.checked_in_at is not null then return v_row; end if;

  if v_row.scheduled_start is not null then
    v_late := greatest(0, floor(extract(epoch from (now() - v_row.scheduled_start)) / 60)::integer - greatest(0, p_grace_minutes));
  end if;

  insert into public.staff_shift_records (
    staff_id, business_unit_id, shift_date, checked_in_at, status, late_minutes
  ) values (
    v_staff_id, p_business_unit_id, current_date, now(), 'active', v_late
  )
  on conflict (staff_id, business_unit_id, shift_date)
  do update set checked_in_at = coalesce(public.staff_shift_records.checked_in_at, excluded.checked_in_at),
                status = 'active',
                late_minutes = excluded.late_minutes,
                updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.end_my_shift(p_business_unit_id uuid, p_after_hours_reason text default null)
returns public.staff_shift_records
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_row public.staff_shift_records;
  v_after integer := 0;
begin
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;

  select * into v_row from public.staff_shift_records
  where staff_id = v_staff_id
    and business_unit_id is not distinct from p_business_unit_id
    and shift_date = current_date;

  if v_row.id is null or v_row.checked_in_at is null then
    raise exception 'Start the shift before ending it.';
  end if;

  if v_row.scheduled_end is not null then
    v_after := greatest(0, floor(extract(epoch from (now() - v_row.scheduled_end)) / 60)::integer);
  end if;

  update public.staff_shift_records
  set checked_out_at = now(), status = 'completed', after_hours_minutes = v_after,
      after_hours_reason = nullif(trim(p_after_hours_reason), ''), updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.claim_my_operation_checklist(p_business_unit_id uuid, p_checklist_type text)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_run_id uuid;
  v_items text[];
  v_item text;
  v_position integer := 0;
begin
  if p_checklist_type not in ('opening','closing') then raise exception 'Invalid checklist type.'; end if;
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;

  insert into public.operation_checklist_runs (staff_id, business_unit_id, run_date, checklist_type)
  values (v_staff_id, p_business_unit_id, current_date, p_checklist_type)
  on conflict (business_unit_id, run_date, checklist_type) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select id into v_run_id from public.operation_checklist_runs
    where business_unit_id is not distinct from p_business_unit_id
      and run_date = current_date and checklist_type = p_checklist_type;
  end if;

  if not exists (select 1 from public.operation_checklist_run_items where run_id = v_run_id) then
    v_items := case when p_checklist_type = 'opening' then
      array['Unlock and inspect the shop','Turn on lights, music and POS','Check waiting area and washroom','Prepare towels and shared supplies','Confirm the shop is ready for clients']
    else
      array['Clean stations and mirrors','Sweep floors and empty garbage','Secure cash, POS and shared equipment','Turn off music and unnecessary lights','Lock doors and confirm the shop is closed']
    end;

    foreach v_item in array v_items loop
      v_position := v_position + 1;
      insert into public.operation_checklist_run_items (run_id, position, label)
      values (v_run_id, v_position, v_item);
    end loop;
  end if;

  return v_run_id;
end;
$function$;

create or replace function public.set_my_operation_item(p_item_id uuid, p_completed boolean, p_note text default null, p_photo_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_run_id uuid;
  v_remaining integer;
begin
  select i.run_id into v_run_id
  from public.operation_checklist_run_items i
  join public.operation_checklist_runs r on r.id = i.run_id
  where i.id = p_item_id and r.staff_id = v_staff_id;

  if v_run_id is null then raise exception 'Checklist item is not assigned to you.'; end if;

  update public.operation_checklist_run_items
  set completed = p_completed,
      completed_at = case when p_completed then now() else null end,
      completed_by_staff_id = case when p_completed then v_staff_id else null end,
      note = nullif(trim(p_note), ''),
      photo_url = nullif(trim(p_photo_url), '')
  where id = p_item_id;

  select count(*) into v_remaining
  from public.operation_checklist_run_items
  where run_id = v_run_id and not completed;

  update public.operation_checklist_runs
  set status = case when v_remaining = 0 then 'completed' else 'in_progress' end,
      completed_at = case when v_remaining = 0 then now() else null end,
      updated_at = now()
  where id = v_run_id;

  return jsonb_build_object('run_id', v_run_id, 'remaining', v_remaining);
end;
$function$;

grant execute on function public.get_my_daily_operations(uuid) to authenticated;
grant execute on function public.start_my_shift(uuid, integer) to authenticated;
grant execute on function public.end_my_shift(uuid, text) to authenticated;
grant execute on function public.claim_my_operation_checklist(uuid, text) to authenticated;
grant execute on function public.set_my_operation_item(uuid, boolean, text, text) to authenticated;

commit;
