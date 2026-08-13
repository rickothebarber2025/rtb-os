create or replace function public.claim_my_operation_checklist(
  p_business_unit_id uuid,
  p_checklist_type text,
  p_scope text default 'shared'::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_staff_role text;
  v_services jsonb := '[]'::jsonb;
  v_audiences text[] := array['all'];
  v_run_id uuid;
begin
  if p_checklist_type not in ('opening','closing') then
    raise exception 'Invalid checklist type.';
  end if;
  if p_scope not in ('station','shared','cleaning') then
    raise exception 'Invalid checklist scope.';
  end if;
  if not private.can_access_business_unit(p_business_unit_id) then
    raise exception 'You do not have access to this business.';
  end if;
  if v_staff_id is null then
    raise exception 'No staff profile is linked to this account.';
  end if;

  select
    lower(coalesce(role, '')),
    case
      when jsonb_typeof(services_offered) = 'array' then services_offered
      else '[]'::jsonb
    end
  into v_staff_role, v_services
  from public.staff
  where id = v_staff_id;

  if v_staff_role like '%clean%' or v_staff_role like '%operations%' then
    v_audiences := array['all','operations_cleaning'];
    if p_scope = 'station' then
      raise exception 'Station checklist does not apply to Operations Cleaning.';
    end if;
  else
    if v_staff_role like '%nail%'
       or exists (
         select 1
         from jsonb_array_elements_text(v_services) s(value)
         where lower(s.value) ~ 'manicure|nail'
       ) then
      v_audiences := array_append(v_audiences, 'nail');
    end if;

    if v_staff_role like '%nail%'
       or exists (
         select 1
         from jsonb_array_elements_text(v_services) s(value)
         where lower(s.value) ~ 'pedicure'
       ) then
      v_audiences := array_append(v_audiences, 'pedicure');
    end if;

    if v_staff_role like '%lash%'
       or exists (
         select 1
         from jsonb_array_elements_text(v_services) s(value)
         where lower(s.value) ~ 'lash'
       ) then
      v_audiences := array_append(v_audiences, 'lash');
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_services) s(value)
      where lower(s.value) ~ 'wax'
    ) then
      v_audiences := array_append(v_audiences, 'waxing');
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(v_services) s(value)
      where lower(s.value) ~ 'facial'
    ) then
      v_audiences := array_append(v_audiences, 'facial');
    end if;
  end if;

  if p_scope in ('shared','cleaning') then
    insert into public.operation_checklist_runs(
      staff_id,business_unit_id,run_date,checklist_type,scope
    )
    values(
      v_staff_id,
      p_business_unit_id,
      (now() at time zone 'America/Toronto')::date,
      p_checklist_type,
      p_scope
    )
    on conflict (business_unit_id,run_date,checklist_type) where scope = p_scope
    do update
      set staff_id = coalesce(public.operation_checklist_runs.staff_id, excluded.staff_id),
          updated_at = now()
    returning id into v_run_id;
  else
    insert into public.operation_checklist_runs(
      staff_id,business_unit_id,run_date,checklist_type,scope
    )
    values(
      v_staff_id,
      p_business_unit_id,
      (now() at time zone 'America/Toronto')::date,
      p_checklist_type,
      'station'
    )
    on conflict (business_unit_id,run_date,checklist_type,staff_id) where scope = 'station'
    do update set updated_at = now()
    returning id into v_run_id;
  end if;

  insert into public.operation_checklist_run_items(
    run_id,position,label,item_id,required
  )
  select v_run_id,i.sort_order,i.label,i.id,i.required
  from public.operation_checklist_items i
  join public.operation_checklist_templates t on t.id = i.template_id
  where t.business_unit_id = p_business_unit_id
    and t.checklist_type = p_checklist_type
    and i.scope = p_scope
    and i.active
    and (p_scope <> 'station' or i.audience = any(v_audiences))
  on conflict(run_id,position) do nothing;

  if not exists(
    select 1
    from public.operation_checklist_run_items
    where run_id = v_run_id
  ) then
    raise exception 'No active checklist items are configured for this checklist.';
  end if;

  return v_run_id;
end;
$function$;
