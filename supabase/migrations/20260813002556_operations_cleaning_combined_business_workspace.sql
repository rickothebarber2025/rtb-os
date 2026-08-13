create or replace function public.get_my_cleaning_operations_all_businesses()
returns jsonb
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare
  v_template text;
  v_staff_id uuid := private.current_staff_id();
  v_unit record;
  v_payload jsonb;
  v_all_items jsonb := '[]'::jsonb;
  v_all_history jsonb := '[]'::jsonb;
  v_all_notifications jsonb := '[]'::jsonb;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_total int := 0;
  v_done int := 0;
  v_business_count int := 0;
begin
  select coalesce(up.permissions->>'role_template','')
    into v_template
  from public.user_profiles up
  where up.id = auth.uid() and up.active is true;

  if v_template <> 'operations_cleaning' then
    return null;
  end if;
  if v_staff_id is null then
    raise exception 'No staff profile is linked to this account.';
  end if;

  for v_unit in
    select bu.id, bu.name
    from public.business_units bu
    where private.can_access_business_unit(bu.id)
    order by bu.name
  loop
    v_business_count := v_business_count + 1;
    v_payload := public.get_my_daily_operations(v_unit.id);

    v_all_items := v_all_items || coalesce((
      select jsonb_agg(
        item || jsonb_build_object(
          'business_unit_id', v_unit.id,
          'business_unit_name', v_unit.name,
          'category', v_unit.name || ' · ' || coalesce(item->>'category','General')
        )
        order by coalesce((item->>'position')::int, 0)
      )
      from jsonb_array_elements(coalesce(v_payload->'checklists','[]'::jsonb)) run,
           lateral jsonb_array_elements(coalesce(run->'items','[]'::jsonb)) item
      where run->>'scope' = 'cleaning' and run->>'type' = 'opening'
    ), '[]'::jsonb);

    select min((run->>'started_at')::timestamptz), max((run->>'completed_at')::timestamptz)
      into v_started_at, v_completed_at
    from jsonb_array_elements(coalesce(v_payload->'checklists','[]'::jsonb)) run
    where run->>'scope'='cleaning' and run->>'type'='opening';

    v_all_history := v_all_history || coalesce((
      select jsonb_agg(row || jsonb_build_object('business_unit_id',v_unit.id,'business_unit_name',v_unit.name))
      from jsonb_array_elements(coalesce(v_payload->'history','[]'::jsonb)) row
      where row->>'scope' in ('cleaning','shared')
    ), '[]'::jsonb);

    v_all_notifications := v_all_notifications || coalesce((
      select jsonb_agg(row || jsonb_build_object('business_unit_id',v_unit.id,'business_unit_name',v_unit.name))
      from jsonb_array_elements(coalesce(v_payload->'notifications','[]'::jsonb)) row
    ), '[]'::jsonb);
  end loop;

  select count(*), count(*) filter (where item->>'status' <> 'pending')
    into v_total, v_done
  from jsonb_array_elements(v_all_items) item;

  return jsonb_build_object(
    'staff_id', v_staff_id,
    'combined_businesses', true,
    'business_count', v_business_count,
    'shift', null,
    'checklists', case when v_total > 0 then jsonb_build_array(jsonb_build_object(
      'id','operations-cleaning-all-businesses',
      'type','opening',
      'scope','cleaning',
      'status',case when v_done = v_total then 'completed' else 'in_progress' end,
      'completion_percent',case when v_total=0 then 0 else round((v_done::numeric/v_total::numeric)*100)::int end,
      'started_at',v_started_at,
      'completed_at',case when v_done=v_total then v_completed_at else null end,
      'items',v_all_items
    )) else '[]'::jsonb end,
    'history',v_all_history,
    'notifications',v_all_notifications
  );
end;
$$;

create or replace function public.claim_my_cleaning_all_businesses()
returns uuid
language plpgsql
security definer
set search_path to 'public','private'
as $$
declare
  v_template text;
  v_unit record;
  v_run_id uuid;
  v_first_run_id uuid;
begin
  select coalesce(up.permissions->>'role_template','') into v_template
  from public.user_profiles up where up.id=auth.uid() and up.active is true;
  if v_template <> 'operations_cleaning' then return null; end if;

  for v_unit in select bu.id from public.business_units bu where private.can_access_business_unit(bu.id) order by bu.name loop
    v_run_id := public.claim_my_operation_checklist(v_unit.id,'opening','cleaning');
    if v_first_run_id is null then v_first_run_id := v_run_id; end if;
  end loop;
  return v_first_run_id;
end;
$$;

grant execute on function public.get_my_cleaning_operations_all_businesses() to authenticated;
grant execute on function public.claim_my_cleaning_all_businesses() to authenticated;
