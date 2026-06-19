begin;

create or replace function private.sync_performance_from_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inserted_count integer;
  target_run public.payroll_runs%rowtype;
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to sync payroll performance.';
  end if;

  select pr.*
  into target_run
  from public.payroll_runs pr
  where pr.id = p_run_id;

  if target_run.id is null then
    raise exception 'Payroll run not found.';
  end if;

  if target_run.status <> 'locked' then
    raise exception 'Lock payroll before saving performance.';
  end if;

  delete from public.performance_history ph
  where ph.business_unit_id is not distinct from target_run.business_unit_id
    and ph.week_start is not distinct from target_run.week_start
    and ph.staff_id in (
      select pe.staff_id
      from public.payroll_entries pe
      where pe.payroll_run_id = p_run_id
        and pe.staff_id is not null
    );

  insert into public.performance_history (
    payroll_run_id,
    staff_id,
    business_unit_id,
    week_label,
    week_start,
    net_sales,
    tips,
    take_home,
    applied_commission_rate,
    tier,
    under_minimum,
    adjusted
  )
  select
    p_run_id,
    pe.staff_id,
    target_run.business_unit_id,
    target_run.week_label,
    target_run.week_start,
    pe.net_sales,
    pe.tips,
    pe.take_home,
    pe.applied_commission_rate,
    pe.tier_snapshot,
    coalesce(pe.net_sales, 0) < 500,
    pe.adjusted
  from public.payroll_entries pe
  where pe.payroll_run_id = p_run_id
    and pe.staff_id is not null;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

grant execute on function private.sync_performance_from_run(uuid)
to authenticated;

alter function public.lock_payroll_run(uuid) security invoker;
alter function public.save_performance_from_run(uuid) security invoker;

commit;
