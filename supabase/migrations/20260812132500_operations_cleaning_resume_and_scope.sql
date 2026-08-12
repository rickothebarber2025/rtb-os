create or replace function public.claim_my_operation_checklist(p_business_unit_id uuid, p_checklist_type text, p_scope text default 'shared'::text)
returns uuid
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_is_cleaner boolean := false;
  v_scope text := p_scope;
  v_run_id uuid;
begin
  if p_checklist_type not in ('opening','closing') then raise exception 'Invalid checklist type.'; end if;
  if p_scope not in ('station','shared','cleaning') then raise exception 'Invalid checklist scope.'; end if;
  if not private.can_access_business_unit(p_business_unit_id) then raise exception 'You do not have access to this business.'; end if;
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;

  select exists (
    select 1 from public.user_profiles up
    where up.id=auth.uid() and up.active
      and (lower(coalesce(up.role_title,''))='operations cleaning'
           or lower(coalesce(up.permissions->>'role_template',''))='operations_cleaning')
  ) into v_is_cleaner;

  if v_is_cleaner then
    if p_scope='station' then raise exception 'My Station does not apply to Operations Cleaning. Use Shared Shop.'; end if;
    if p_scope='shared' then v_scope:='cleaning'; end if;
  end if;

  if v_scope='shared' then
    insert into public.operation_checklist_runs(staff_id,business_unit_id,run_date,checklist_type,scope)
    values(v_staff_id,p_business_unit_id,(now() at time zone 'America/Toronto')::date,p_checklist_type,'shared')
    on conflict (business_unit_id,run_date,checklist_type) where scope='shared'
    do update set staff_id=coalesce(public.operation_checklist_runs.staff_id,excluded.staff_id),updated_at=now()
    returning id into v_run_id;
  elsif v_scope='cleaning' then
    insert into public.operation_checklist_runs(staff_id,business_unit_id,run_date,checklist_type,scope)
    values(v_staff_id,p_business_unit_id,(now() at time zone 'America/Toronto')::date,p_checklist_type,'cleaning')
    on conflict (business_unit_id,run_date,checklist_type) where scope='cleaning'
    do update set staff_id=coalesce(public.operation_checklist_runs.staff_id,excluded.staff_id),updated_at=now()
    returning id into v_run_id;
  else
    insert into public.operation_checklist_runs(staff_id,business_unit_id,run_date,checklist_type,scope)
    values(v_staff_id,p_business_unit_id,(now() at time zone 'America/Toronto')::date,p_checklist_type,'station')
    on conflict (business_unit_id,run_date,checklist_type,staff_id) where scope='station'
    do update set updated_at=now()
    returning id into v_run_id;
  end if;

  insert into public.operation_checklist_run_items(run_id,position,label,item_id,required)
  select v_run_id,i.sort_order,i.label,i.id,i.required
  from public.operation_checklist_items i
  join public.operation_checklist_templates t on t.id=i.template_id
  where t.business_unit_id=p_business_unit_id and t.checklist_type=p_checklist_type and i.scope=v_scope and i.active
  on conflict (run_id,position) do nothing;

  if not exists(select 1 from public.operation_checklist_run_items where run_id=v_run_id) then
    raise exception 'No active checklist items are configured for this checklist.';
  end if;
  return v_run_id;
end;
$function$;

create or replace function public.get_my_daily_operations(p_business_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_shift public.staff_shift_records;
  v_runs jsonb;
  v_notifications jsonb;
  v_is_cleaner boolean := false;
  v_local_date date := (now() at time zone 'America/Toronto')::date;
begin
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;

  select exists (
    select 1 from public.user_profiles up
    where up.id=auth.uid() and up.active
      and (lower(coalesce(up.role_title,''))='operations cleaning'
           or lower(coalesce(up.permissions->>'role_template',''))='operations_cleaning')
  ) into v_is_cleaner;

  select * into v_shift from public.staff_shift_records
  where staff_id=v_staff_id and business_unit_id is not distinct from p_business_unit_id and shift_date=v_local_date;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',r.id,'type',r.checklist_type,
      'scope',case when v_is_cleaner and r.scope='cleaning' then 'shared' else r.scope end,
      'status',r.status,'completion_percent',r.completion_percent,
      'started_at',r.started_at,'completed_at',r.completed_at,
      'final_confirmed_by',r.final_confirmed_by,'final_confirmed_by_name',fs.full_name,
      'final_confirmed_at',r.final_confirmed_at,
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,'position',i.position,'label',i.label,'required',i.required,'status',i.status,
        'completed',i.completed,'completed_at',i.completed_at,'completed_by_staff_id',i.completed_by_staff_id,
        'completed_by_name',cs.full_name,'photo_url',i.photo_url,'note',i.note
      ) order by i.position)
      from public.operation_checklist_run_items i
      left join public.staff cs on cs.id=i.completed_by_staff_id
      where i.run_id=r.id),'[]'::jsonb)
    ) order by r.checklist_type,r.scope
  ),'[]'::jsonb) into v_runs
  from public.operation_checklist_runs r
  left join public.staff fs on fs.id=r.final_confirmed_by
  where r.run_date=v_local_date and r.business_unit_id is not distinct from p_business_unit_id
    and ((v_is_cleaner and r.scope='cleaning') or (not v_is_cleaner and (
      r.staff_id=v_staff_id or (r.scope in ('shared','cleaning') and private.staff_hub_business_view(r.business_unit_id))
      or private.staff_hub_business_admin(r.business_unit_id,'view')
    )));

  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc),'[]'::jsonb) into v_notifications
  from public.staff_operation_notifications n
  where n.staff_id=v_staff_id and n.business_unit_id is not distinct from p_business_unit_id and n.created_at>=(v_local_date-7);

  return jsonb_build_object('staff_id',v_staff_id,'operations_cleaning',v_is_cleaner,
    'shift',case when v_shift.id is null then null else to_jsonb(v_shift) end,
    'checklists',v_runs,'notifications',v_notifications);
end;
$function$;

create or replace function public.confirm_operation_shift(p_business_unit_id uuid,p_checklist_type text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_is_cleaner boolean := false;
  v_scope text := 'shared';
  v_run_id uuid;
  v_blocking integer;
  v_local_date date := (now() at time zone 'America/Toronto')::date;
begin
  if p_checklist_type not in ('opening','closing') then raise exception 'Invalid checklist type.'; end if;
  if not private.can_access_business_unit(p_business_unit_id) then raise exception 'You do not have access to this business.'; end if;
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;

  select exists (
    select 1 from public.user_profiles up
    where up.id=auth.uid() and up.active
      and (lower(coalesce(up.role_title,''))='operations cleaning'
           or lower(coalesce(up.permissions->>'role_template',''))='operations_cleaning')
  ) into v_is_cleaner;
  if v_is_cleaner then v_scope:='cleaning'; end if;

  select id into v_run_id from public.operation_checklist_runs
  where business_unit_id=p_business_unit_id and run_date=v_local_date and checklist_type=p_checklist_type and scope=v_scope
  order by created_at desc limit 1 for update;

  if v_run_id is null then
    if v_is_cleaner then raise exception 'Start the Shared Shop cleaning checklist before finishing.';
    else raise exception 'Start the shared checklist before confirming the shift.'; end if;
  end if;

  select count(*) into v_blocking from public.operation_checklist_run_items
  where run_id=v_run_id and required and status='pending';
  if v_blocking>0 then
    return jsonb_build_object('confirmed',false,'blocking_tasks',v_blocking,
      'message',format('%s required task%s still need%s to be completed.',v_blocking,
      case when v_blocking=1 then '' else 's' end,case when v_blocking=1 then 's' else '' end));
  end if;

  update public.operation_checklist_runs
  set staff_id=coalesce(staff_id,v_staff_id),final_confirmed_by=v_staff_id,final_confirmed_at=now(),
      status='completed',completion_percent=100,completed_at=coalesce(completed_at,now()),updated_at=now()
  where id=v_run_id;

  if not v_is_cleaner then
    insert into public.shop_status_events(business_unit_id,status,staff_id,note)
    values(p_business_unit_id,case when p_checklist_type='opening' then 'open' else 'closed' end,
      v_staff_id,format('%s checklist confirmed',p_checklist_type));
  end if;

  return jsonb_build_object('confirmed',true,'run_id',v_run_id,'staff_id',v_staff_id,
    'checklist_type',p_checklist_type,'confirmed_at',now(),'operations_cleaning',v_is_cleaner,
    'shop_status',case when v_is_cleaner then null when p_checklist_type='opening' then 'open' else 'closed' end);
end;
$function$;
