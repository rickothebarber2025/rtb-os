begin;

create table if not exists public.cleaner_station_inspections (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete set null,
  inspector_staff_id uuid not null references public.staff(id) on delete restrict,
  responsible_staff_id uuid references public.staff(id) on delete set null,
  station_label text,
  status text not null check (status in ('passed','needs_attention','failed','not_inspected')),
  note text,
  photo_url text,
  inspected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists cleaner_station_inspections_business_date_idx
  on public.cleaner_station_inspections (business_unit_id, inspected_at desc);

alter table public.cleaner_station_inspections enable row level security;
grant select, insert on public.cleaner_station_inspections to authenticated;

drop policy if exists cleaner_station_inspections_select on public.cleaner_station_inspections;
create policy cleaner_station_inspections_select
on public.cleaner_station_inspections for select to authenticated
using (
  inspector_staff_id = private.current_staff_id()
  or responsible_staff_id = private.current_staff_id()
  or private.staff_hub_business_admin(business_unit_id, 'view')
);

drop policy if exists cleaner_station_inspections_insert on public.cleaner_station_inspections;
create policy cleaner_station_inspections_insert
on public.cleaner_station_inspections for insert to authenticated
with check (
  inspector_staff_id = private.current_staff_id()
  and (
    private.staff_hub_business_admin(business_unit_id, 'edit')
    or exists (
      select 1 from public.user_profiles up
      where up.id = auth.uid()
        and up.active
        and up.permissions->>'role_template' = 'operations_cleaning'
    )
  )
);

create or replace function public.get_my_cleaner_dashboard(p_business_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_role_template text;
  v_daily jsonb;
  v_inspections jsonb;
begin
  if v_staff_id is null then
    raise exception 'No staff profile is linked to this account.';
  end if;

  select permissions->>'role_template'
  into v_role_template
  from public.user_profiles
  where id = auth.uid() and active;

  if coalesce(v_role_template, '') <> 'operations_cleaning'
     and not private.staff_hub_business_admin(p_business_unit_id, 'view') then
    raise exception 'Operations Cleaning access is required.';
  end if;

  v_daily := public.get_my_daily_operations(p_business_unit_id);

  select coalesce(jsonb_agg(to_jsonb(i) order by i.inspected_at desc), '[]'::jsonb)
  into v_inspections
  from public.cleaner_station_inspections i
  where i.inspector_staff_id = v_staff_id
    and i.business_unit_id is not distinct from p_business_unit_id
    and i.inspected_at >= (now() at time zone 'America/Toronto')::date - interval '7 days';

  return v_daily || jsonb_build_object(
    'role_template', v_role_template,
    'shift_window', jsonb_build_object('start','08:00','end','10:00','timezone','America/Toronto'),
    'station_inspections', v_inspections
  );
end;
$function$;

create or replace function public.claim_my_cleaner_checklist(p_business_unit_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_role_template text;
begin
  select permissions->>'role_template'
  into v_role_template
  from public.user_profiles
  where id = auth.uid() and active;

  if coalesce(v_role_template, '') <> 'operations_cleaning'
     and not private.staff_hub_business_admin(p_business_unit_id, 'edit') then
    raise exception 'Operations Cleaning access is required.';
  end if;

  return public.claim_my_operation_checklist(p_business_unit_id, 'opening', 'shared');
end;
$function$;

create or replace function public.mark_shop_ready(p_business_unit_id uuid, p_photo_url text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_result jsonb;
  v_run_id uuid;
begin
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;
  if nullif(trim(p_photo_url), '') is null then raise exception 'A final walkthrough photo is required.'; end if;

  select r.id into v_run_id
  from public.operation_checklist_runs r
  where r.business_unit_id is not distinct from p_business_unit_id
    and r.run_date = (now() at time zone 'America/Toronto')::date
    and r.checklist_type = 'opening'
    and r.scope = 'shared'
  order by r.created_at desc
  limit 1;

  if v_run_id is null then raise exception 'Start the opening cleaning checklist first.'; end if;

  update public.operation_checklist_run_items
  set photo_url = coalesce(nullif(photo_url,''), trim(p_photo_url)), updated_at = now()
  where run_id = v_run_id
    and label ilike '%ready%open%';

  v_result := public.confirm_operation_shift(p_business_unit_id, 'opening');
  if coalesce((v_result->>'confirmed')::boolean, false) is not true then
    return v_result;
  end if;

  return v_result || jsonb_build_object(
    'ready', true,
    'staff_id', v_staff_id,
    'ready_at', now(),
    'photo_url', trim(p_photo_url)
  );
end;
$function$;

create or replace function public.submit_station_inspection(
  p_business_unit_id uuid,
  p_responsible_staff_id uuid,
  p_status text,
  p_note text default null,
  p_photo_url text default null,
  p_station_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_row public.cleaner_station_inspections;
begin
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;
  if p_status not in ('passed','needs_attention','failed','not_inspected') then raise exception 'Invalid station inspection status.'; end if;
  if p_status = 'failed' and p_responsible_staff_id is null then raise exception 'Failed inspections require a responsible staff member.'; end if;
  if p_status = 'failed' and nullif(trim(p_photo_url), '') is null then raise exception 'Failed inspections require photo evidence.'; end if;
  if p_status = 'failed' and nullif(trim(p_note), '') is null then raise exception 'Failed inspections require a written note.'; end if;

  insert into public.cleaner_station_inspections (
    business_unit_id, inspector_staff_id, responsible_staff_id,
    station_label, status, note, photo_url
  ) values (
    p_business_unit_id, v_staff_id, p_responsible_staff_id,
    nullif(trim(p_station_label), ''), p_status,
    nullif(trim(p_note), ''), nullif(trim(p_photo_url), '')
  ) returning * into v_row;

  return jsonb_build_object(
    'inspection_id', v_row.id,
    'inspector_staff_id', v_row.inspector_staff_id,
    'responsible_staff_id', v_row.responsible_staff_id,
    'status', v_row.status,
    'created_at', v_row.created_at
  );
end;
$function$;

grant execute on function public.get_my_cleaner_dashboard(uuid) to authenticated;
grant execute on function public.claim_my_cleaner_checklist(uuid) to authenticated;
grant execute on function public.mark_shop_ready(uuid,text) to authenticated;
grant execute on function public.submit_station_inspection(uuid,uuid,text,text,text,text) to authenticated;

commit;
