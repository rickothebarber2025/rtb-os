create or replace function public.start_my_shift(p_business_unit_id uuid, p_grace_minutes integer default 10)
returns public.staff_shift_records
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_row public.staff_shift_records;
  v_late integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;
  if not private.can_access_business_unit(p_business_unit_id) then
    raise exception 'You do not have access to this business.';
  end if;

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
set search_path to 'public','private'
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_role_template text;
  v_row public.cleaner_station_inspections;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;
  if not private.can_access_business_unit(p_business_unit_id) then
    raise exception 'You do not have access to this business.';
  end if;

  select permissions->>'role_template'
  into v_role_template
  from public.user_profiles
  where id = auth.uid() and active;

  if coalesce(v_role_template, '') <> 'operations_cleaning'
     and not private.staff_hub_business_admin(p_business_unit_id, 'edit') then
    raise exception 'Operations Cleaning or business admin access is required.';
  end if;

  if p_responsible_staff_id is not null and not exists (
    select 1 from public.staff s
    where s.id = p_responsible_staff_id
      and s.active
      and s.business_unit_id is not distinct from p_business_unit_id
  ) then
    raise exception 'Responsible staff member is not active in this business.';
  end if;

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

create or replace function public.get_monthly_operations_leaderboard(p_business_unit_id uuid, p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_month date;
begin
  if auth.uid() is null or private.current_staff_id() is null then
    raise exception 'You do not have access to this business.';
  end if;
  if not private.can_access_business_unit(p_business_unit_id) then
    raise exception 'You do not have access to this business.';
  end if;

  v_month := p_month;

  if v_month is null or not exists (
    select 1 from public.staff_monthly_performance_summary
    where business_unit_id = p_business_unit_id and month_start = v_month and not exclude_from_leaderboard
  ) then
    select month_start into v_month
    from public.staff_monthly_performance_summary
    where business_unit_id = p_business_unit_id and not exclude_from_leaderboard
    order by month_start desc
    limit 1;
  end if;

  if v_month is null then
    return jsonb_build_object('month', null, 'top', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'month', v_month,
    'top', coalesce((
      select jsonb_agg(ranked order by ranked.rank)
      from (
        select
          row_number() over (order by t.total_net_sales desc) as rank,
          t.staff_id,
          t.full_name,
          t.role,
          t.photo_url
        from (
          select
            m.staff_id,
            m.full_name,
            m.role,
            s.photo_url,
            m.total_net_sales
          from public.staff_monthly_performance_summary m
          join public.staff s on s.id = m.staff_id
          where m.business_unit_id = p_business_unit_id
            and m.month_start = v_month
            and not m.exclude_from_leaderboard
        ) t
      ) ranked
      where ranked.rank <= 3
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_my_daily_operations(p_business_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
 v_staff_id uuid:=private.current_staff_id(); v_shift public.staff_shift_records; v_runs jsonb; v_notifications jsonb; v_history jsonb; v_local_date date:=(now() at time zone 'America/Toronto')::date;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;
 if not private.can_access_business_unit(p_business_unit_id) then raise exception 'You do not have access to this business.'; end if;
 select * into v_shift from public.staff_shift_records where staff_id=v_staff_id and business_unit_id is not distinct from p_business_unit_id and shift_date=v_local_date;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'type',r.checklist_type,'scope',r.scope,'status',r.status,'completion_percent',r.completion_percent,'started_at',r.started_at,'completed_at',r.completed_at,'final_confirmed_by',r.final_confirmed_by,'final_confirmed_by_name',fs.full_name,'final_confirmed_at',r.final_confirmed_at,'items',coalesce((select jsonb_agg(jsonb_build_object('id',ri.id,'position',ri.position,'label',ri.label,'required',ri.required,'status',ri.status,'completed',ri.completed,'completed_at',ri.completed_at,'completed_by_staff_id',ri.completed_by_staff_id,'completed_by_name',cs.full_name,'photo_url',ri.photo_url,'note',ri.note,'category',coalesce(ci.category,'General'),'audience',coalesce(ci.audience,'all')) order by ri.position) from public.operation_checklist_run_items ri left join public.staff cs on cs.id=ri.completed_by_staff_id left join public.operation_checklist_items ci on ci.id=ri.item_id where ri.run_id=r.id),'[]'::jsonb)) order by r.checklist_type,r.scope),'[]'::jsonb) into v_runs
 from public.operation_checklist_runs r left join public.staff fs on fs.id=r.final_confirmed_by where r.run_date=v_local_date and r.business_unit_id is not distinct from p_business_unit_id and (r.staff_id=v_staff_id or (r.scope in ('shared','cleaning') and private.staff_hub_business_view(r.business_unit_id)) or private.staff_hub_business_admin(r.business_unit_id,'view'));
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'date',r.run_date,'type',r.checklist_type,'scope',r.scope,'status',r.status,'completion_percent',r.completion_percent,'started_at',r.started_at,'completed_at',r.completed_at,'staff_id',r.staff_id,'staff_name',s.full_name,'completed_items',(select count(*) from public.operation_checklist_run_items ri where ri.run_id=r.id and ri.status='completed'),'total_items',(select count(*) from public.operation_checklist_run_items ri where ri.run_id=r.id)) order by r.run_date desc,r.started_at desc),'[]'::jsonb) into v_history
 from public.operation_checklist_runs r left join public.staff s on s.id=r.staff_id where r.business_unit_id is not distinct from p_business_unit_id and r.run_date >= v_local_date-30 and (r.staff_id=v_staff_id or r.scope='cleaning' or private.staff_hub_business_admin(r.business_unit_id,'view'));
 select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb) into v_notifications from public.staff_operation_notifications n where n.staff_id=v_staff_id and n.business_unit_id is not distinct from p_business_unit_id and n.created_at >= v_local_date-7;
 return jsonb_build_object('staff_id',v_staff_id,'shift',case when v_shift.id is null then null else to_jsonb(v_shift) end,'checklists',v_runs,'history',v_history,'notifications',v_notifications);
end;
$function$;

create or replace function public.mark_shop_ready(p_business_unit_id uuid, p_photo_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_result jsonb;
  v_run_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;
  if not private.can_access_business_unit(p_business_unit_id) then raise exception 'You do not have access to this business.'; end if;
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
