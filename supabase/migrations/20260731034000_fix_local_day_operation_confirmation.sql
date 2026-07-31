begin;

create or replace function public.confirm_operation_shift(p_business_unit_id uuid, p_checklist_type text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_run_id uuid;
  v_blocking integer;
  v_local_date date := (now() at time zone 'America/Toronto')::date;
begin
  if p_checklist_type not in ('opening','closing') then
    raise exception 'Invalid checklist type.';
  end if;
  if not private.can_access_business_unit(p_business_unit_id) then
    raise exception 'You do not have access to this business.';
  end if;
  if v_staff_id is null then
    raise exception 'No staff profile is linked to this account.';
  end if;

  select id into v_run_id
  from public.operation_checklist_runs
  where business_unit_id = p_business_unit_id
    and run_date = v_local_date
    and checklist_type = p_checklist_type
    and scope = 'shared'
  order by created_at desc
  limit 1
  for update;

  if v_run_id is null then
    raise exception 'Start the shared checklist before confirming the shift.';
  end if;

  select count(*) into v_blocking
  from public.operation_checklist_run_items
  where run_id = v_run_id
    and required
    and status = 'pending';

  if v_blocking > 0 then
    return jsonb_build_object(
      'confirmed', false,
      'blocking_tasks', v_blocking,
      'message', format('%s required task%s still need%s to be completed.',
        v_blocking,
        case when v_blocking = 1 then '' else 's' end,
        case when v_blocking = 1 then 's' else '' end)
    );
  end if;

  update public.operation_checklist_runs
  set staff_id = coalesce(staff_id, v_staff_id),
      final_confirmed_by = v_staff_id,
      final_confirmed_at = now(),
      status = 'completed',
      completion_percent = 100,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = v_run_id;

  insert into public.shop_status_events (business_unit_id, status, staff_id, note)
  values (
    p_business_unit_id,
    case when p_checklist_type = 'opening' then 'open' else 'closed' end,
    v_staff_id,
    format('%s checklist confirmed', p_checklist_type)
  );

  return jsonb_build_object(
    'confirmed', true,
    'run_id', v_run_id,
    'staff_id', v_staff_id,
    'checklist_type', p_checklist_type,
    'confirmed_at', now(),
    'shop_status', case when p_checklist_type = 'opening' then 'open' else 'closed' end
  );
end;
$function$;

grant execute on function public.confirm_operation_shift(uuid,text) to authenticated;

commit;
