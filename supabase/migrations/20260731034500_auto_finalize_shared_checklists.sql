begin;

create or replace function public.auto_finalize_shared_operation_checklist()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_run public.operation_checklist_runs%rowtype;
  v_blocking integer;
  v_staff_id uuid;
  v_status text;
begin
  select * into v_run
  from public.operation_checklist_runs
  where id = new.run_id
  for update;

  if v_run.id is null
     or v_run.scope <> 'shared'
     or v_run.checklist_type not in ('opening','closing')
     or v_run.final_confirmed_at is not null then
    return new;
  end if;

  select count(*) into v_blocking
  from public.operation_checklist_run_items
  where run_id = v_run.id
    and required
    and status = 'pending';

  if v_blocking > 0 then
    return new;
  end if;

  v_staff_id := coalesce(new.completed_by_staff_id, v_run.staff_id);
  if v_staff_id is null then
    return new;
  end if;

  v_status := case when v_run.checklist_type = 'opening' then 'open' else 'closed' end;

  update public.operation_checklist_runs
  set staff_id = coalesce(staff_id, v_staff_id),
      final_confirmed_by = v_staff_id,
      final_confirmed_at = now(),
      status = 'completed',
      completion_percent = 100,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = v_run.id;

  if not exists (
    select 1
    from public.shop_status_events e
    where e.business_unit_id is not distinct from v_run.business_unit_id
      and e.status = v_status
      and e.created_at >= (v_run.run_date::timestamp at time zone 'America/Toronto')
      and e.created_at < ((v_run.run_date + 1)::timestamp at time zone 'America/Toronto')
  ) then
    insert into public.shop_status_events (
      business_unit_id,
      status,
      staff_id,
      note,
      created_by
    ) values (
      v_run.business_unit_id,
      v_status,
      v_staff_id,
      format('%s checklist automatically confirmed at 100%%', v_run.checklist_type),
      auth.uid()
    );
  end if;

  return new;
end;
$function$;

drop trigger if exists auto_finalize_shared_operation_checklist_trigger
  on public.operation_checklist_run_items;

create trigger auto_finalize_shared_operation_checklist_trigger
after insert or update of status, completed, completed_by_staff_id
on public.operation_checklist_run_items
for each row
execute function public.auto_finalize_shared_operation_checklist();

commit;
