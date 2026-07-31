begin;

create or replace function public.end_my_shift(
  p_business_unit_id uuid,
  p_after_hours_reason text default null
)
returns public.staff_shift_records
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_staff_id uuid := private.current_staff_id();
  v_row public.staff_shift_records;
  v_after integer := 0;
  v_local_date date := (now() at time zone 'America/Toronto')::date;
  v_closing_run_id uuid;
  v_required_total integer := 0;
  v_required_remaining integer := 0;
begin
  if v_staff_id is null then
    raise exception 'No staff profile is linked to this account.';
  end if;

  select * into v_row
  from public.staff_shift_records
  where staff_id = v_staff_id
    and business_unit_id is not distinct from p_business_unit_id
    and shift_date = v_local_date;

  if v_row.id is null or v_row.checked_in_at is null then
    raise exception 'Start the shift before ending it.';
  end if;

  select r.id into v_closing_run_id
  from public.operation_checklist_runs r
  where r.business_unit_id is not distinct from p_business_unit_id
    and r.run_date = v_local_date
    and r.checklist_type = 'closing'
    and r.scope = 'shared'
    and r.staff_id = v_staff_id
  order by r.created_at desc
  limit 1;

  if v_closing_run_id is not null then
    select
      count(*) filter (where required),
      count(*) filter (where required and status = 'pending')
    into v_required_total, v_required_remaining
    from public.operation_checklist_run_items
    where run_id = v_closing_run_id;

    if v_required_remaining > 0 then
      raise exception using
        message = format(
          'Closing is not finished. %s of %s required task%s still need%s to be completed before you can end your shift.',
          v_required_remaining,
          v_required_total,
          case when v_required_total = 1 then '' else 's' end,
          case when v_required_remaining = 1 then 's' else '' end
        ),
        hint = 'Return to the closing checklist and complete every required item. Add a note where the app allows an item to be skipped or could not be completed.';
    end if;

    if exists (
      select 1
      from public.operation_checklist_runs r
      where r.id = v_closing_run_id
        and r.final_confirmed_at is null
    ) then
      raise exception using
        message = 'All closing tasks are checked, but the shop has not been confirmed closed yet.',
        hint = 'Complete the final closing confirmation before ending your shift.';
    end if;
  end if;

  if v_row.scheduled_end is not null then
    v_after := greatest(0, floor(extract(epoch from (now() - v_row.scheduled_end)) / 60)::integer);
  end if;

  update public.staff_shift_records
  set checked_out_at = now(),
      status = 'completed',
      after_hours_minutes = v_after,
      after_hours_reason = nullif(trim(p_after_hours_reason), ''),
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.end_my_shift(uuid,text) to authenticated;

commit;
