create or replace function public.claim_my_operation_checklist(p_business_unit_id uuid, p_checklist_type text, p_scope text default 'shared')
returns uuid
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_run_id uuid;
begin
  if p_checklist_type not in ('opening','closing') then raise exception 'Invalid checklist type.'; end if;
  if p_scope not in ('station','shared') then raise exception 'Invalid checklist scope.'; end if;
  if not private.can_access_business_unit(p_business_unit_id) then
    raise exception 'You do not have access to this business.';
  end if;
  if v_staff_id is null then raise exception 'No staff profile is linked to this account.'; end if;

  if p_scope = 'shared' then
    insert into public.operation_checklist_runs (staff_id, business_unit_id, run_date, checklist_type, scope)
    values (v_staff_id, p_business_unit_id, (now() at time zone 'America/Toronto')::date, p_checklist_type, 'shared')
    on conflict (business_unit_id, run_date, checklist_type) where scope = 'shared'
    do update set
      staff_id = coalesce(public.operation_checklist_runs.staff_id, excluded.staff_id),
      updated_at = now()
    returning id into v_run_id;
  else
    insert into public.operation_checklist_runs (staff_id, business_unit_id, run_date, checklist_type, scope)
    values (v_staff_id, p_business_unit_id, (now() at time zone 'America/Toronto')::date, p_checklist_type, 'station')
    on conflict (business_unit_id, run_date, checklist_type, staff_id) where scope = 'station'
    do update set updated_at = now()
    returning id into v_run_id;
  end if;

  insert into public.operation_checklist_run_items (run_id, position, label, item_id, required)
  select v_run_id, i.sort_order, i.label, i.id, i.required
  from public.operation_checklist_items i
  join public.operation_checklist_templates t on t.id = i.template_id
  where t.business_unit_id = p_business_unit_id
    and t.checklist_type = p_checklist_type
    and i.scope = p_scope
    and i.active
  on conflict (run_id, position) do nothing;

  if not exists (select 1 from public.operation_checklist_run_items where run_id = v_run_id) then
    raise exception 'No active checklist items are configured for this checklist.';
  end if;

  return v_run_id;
end;
$function$;

grant execute on function public.claim_my_operation_checklist(uuid,text,text) to authenticated;
