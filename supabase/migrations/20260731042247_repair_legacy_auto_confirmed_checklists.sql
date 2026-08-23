begin;

-- Repair shared opening/closing runs that reached 100% before automatic
-- confirmation was introduced. Fresh databases may not yet have the later
-- scope column, and have no legacy runs to repair, so guard this production-only
-- backfill and parse it dynamically.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operation_checklist_runs'
      and column_name = 'scope'
  ) then
    execute $repair$
      with repairable as (
        select
          r.id,
          coalesce(
            r.staff_id,
            (
              select ri.completed_by_staff_id
              from public.operation_checklist_run_items ri
              where ri.run_id = r.id
                and ri.completed_by_staff_id is not null
              order by ri.completed_at desc nulls last
              limit 1
            )
          ) as responsible_staff_id,
          coalesce(
            r.completed_at,
            (
              select max(ri.completed_at)
              from public.operation_checklist_run_items ri
              where ri.run_id = r.id
            ),
            r.updated_at,
            r.created_at,
            now()
          ) as confirmed_at
        from public.operation_checklist_runs r
        where r.scope = 'shared'
          and r.checklist_type in ('opening', 'closing')
          and coalesce(r.completion_percent, 0) = 100
          and r.final_confirmed_at is null
      ), updated as (
        update public.operation_checklist_runs r
        set staff_id = coalesce(r.staff_id, repairable.responsible_staff_id),
            final_confirmed_by = repairable.responsible_staff_id,
            final_confirmed_at = repairable.confirmed_at,
            completed_at = coalesce(r.completed_at, repairable.confirmed_at),
            status = 'completed',
            updated_at = now()
        from repairable
        where r.id = repairable.id
          and repairable.responsible_staff_id is not null
        returning r.*
      )
      insert into public.shop_status_events (
        business_unit_id,
        status,
        staff_id,
        note,
        created_at
      )
      select
        u.business_unit_id,
        case when u.checklist_type = 'opening' then 'open' else 'closed' end,
        u.final_confirmed_by,
        format('%s checklist automatically confirmed from completed legacy record', u.checklist_type),
        u.final_confirmed_at
      from updated u
      where not exists (
        select 1
        from public.shop_status_events e
        where e.business_unit_id is not distinct from u.business_unit_id
          and e.status = case when u.checklist_type = 'opening' then 'open' else 'closed' end
          and (e.created_at at time zone 'America/Toronto')::date = u.run_date
      )
    $repair$;
  end if;
end;
$$;

commit;
