begin;

-- Managers can manage roster records only inside business units they can access.
drop policy if exists staff_admin_all on public.staff;
drop policy if exists staff_insert_by_manager_or_admin on public.staff;
drop policy if exists staff_update_by_manager_or_admin on public.staff;
drop policy if exists staff_delete_by_admin on public.staff;

create policy staff_insert_by_manager_or_admin
on public.staff
for insert
to authenticated
with check (private.can_access_business_unit(business_unit_id));

create policy staff_update_by_manager_or_admin
on public.staff
for update
to authenticated
using (private.can_access_business_unit(business_unit_id))
with check (private.can_access_business_unit(business_unit_id));

create policy staff_delete_by_admin
on public.staff
for delete
to authenticated
using (private.is_app_admin());

-- Preserve duplicate performance rows before consolidating them.
alter table public.performance_history
  add column if not exists payroll_run_id uuid
  references public.payroll_runs(id)
  on delete cascade;

create table if not exists private.performance_history_duplicate_archive
as
select ph.*, now() as archived_at
from public.performance_history ph
with no data;

with ranked as (
  select
    ph.*,
    row_number() over (
      partition by
        ph.staff_id,
        ph.business_unit_id,
        coalesce(ph.week_start, ph.created_at::date),
        ph.week_label
      order by ph.created_at desc, ph.id desc
    ) as row_number
  from public.performance_history ph
  where ph.staff_id is not null
),
duplicates as (
  select *
  from ranked
  where row_number > 1
)
insert into private.performance_history_duplicate_archive (
  id,
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
  adjusted,
  created_at,
  payroll_run_id,
  archived_at
)
select
  id,
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
  adjusted,
  created_at,
  payroll_run_id,
  now()
from duplicates;

with ranked as (
  select
    ph.id,
    row_number() over (
      partition by
        ph.staff_id,
        ph.business_unit_id,
        coalesce(ph.week_start, ph.created_at::date),
        ph.week_label
      order by ph.created_at desc, ph.id desc
    ) as row_number
  from public.performance_history ph
  where ph.staff_id is not null
)
delete from public.performance_history ph
using ranked
where ph.id = ranked.id
  and ranked.row_number > 1;

update public.performance_history ph
set payroll_run_id = (
  select pr.id
  from public.payroll_runs pr
  where pr.business_unit_id is not distinct from ph.business_unit_id
    and pr.week_label = ph.week_label
    and pr.week_start is not distinct from ph.week_start
    and pr.status = 'locked'
  order by abs(extract(epoch from (pr.created_at - ph.created_at))), pr.created_at desc
  limit 1
)
where ph.payroll_run_id is null;

create unique index if not exists performance_history_staff_week_unique
on public.performance_history (
  business_unit_id,
  staff_id,
  week_start,
  week_label
)
where staff_id is not null;

alter table public.performance_history
  alter column week_start set not null;

create index if not exists performance_history_payroll_run_id_idx
on public.performance_history(payroll_run_id);

-- Locked payroll is immutable and can only transition through lock_payroll_run().
create or replace function private.protect_payroll_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and old.status = 'locked' then
    raise exception 'Locked payroll runs cannot be deleted.';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'locked' then
      raise exception 'Locked payroll runs cannot be changed.';
    end if;

    if new.status = 'locked'
      and coalesce(current_setting('rtb.locking_payroll_run', true), '') <> 'on'
    then
      raise exception 'Use lock_payroll_run() to lock payroll.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_payroll_run on public.payroll_runs;
create trigger protect_payroll_run
before update or delete on public.payroll_runs
for each row
execute function private.protect_payroll_run();

create or replace function private.protect_payroll_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_run_id uuid;
  target_status text;
begin
  target_run_id := case
    when tg_op = 'DELETE' then old.payroll_run_id
    else new.payroll_run_id
  end;

  select pr.status
  into target_status
  from public.payroll_runs pr
  where pr.id = target_run_id;

  if target_status = 'locked' then
    raise exception 'Entries in a locked payroll run cannot be changed.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

drop trigger if exists protect_payroll_entry on public.payroll_entries;
create trigger protect_payroll_entry
before insert or update or delete on public.payroll_entries
for each row
execute function private.protect_payroll_entry();

create or replace function public.calculate_staff_take_home(
  p_net numeric,
  p_tips numeric,
  p_base_comm numeric,
  p_fixed boolean
)
returns table(
  applied_commission_rate numeric,
  adjusted boolean,
  take_home numeric
)
language plpgsql
set search_path = ''
as $function$
begin
  if p_fixed then
    applied_commission_rate := coalesce(p_base_comm, 0);
    adjusted := false;
  elsif coalesce(p_net, 0) >= 500 then
    applied_commission_rate := coalesce(p_base_comm, 0);
    adjusted := false;
  else
    applied_commission_rate := least(coalesce(p_base_comm, 0), 55);
    adjusted := applied_commission_rate <> coalesce(p_base_comm, 0);
  end if;

  take_home := greatest(
    0,
    (coalesce(p_net, 0) * applied_commission_rate / 100)
      - 5
      + coalesce(p_tips, 0)
  );
  return next;
end;
$function$;

create or replace function public.lock_payroll_run(p_run_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  current_status text;
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to lock payroll.';
  end if;

  select pr.status
  into current_status
  from public.payroll_runs pr
  where pr.id = p_run_id
  for update;

  if current_status is null then
    raise exception 'Payroll run not found.';
  end if;

  if current_status <> 'draft' then
    raise exception 'Only draft payroll runs can be locked.';
  end if;

  if exists (
    select 1
    from public.payroll_runs pr
    where pr.id = p_run_id
      and (pr.week_start is null or pr.week_end is null)
  ) then
    raise exception 'Payroll week start and end dates are required before locking.';
  end if;

  perform set_config('rtb.locking_payroll_run', 'on', true);

  update public.payroll_runs
  set status = 'locked',
      locked_at = now(),
      updated_at = now()
  where id = p_run_id;
end;
$function$;

create or replace function public.save_performance_from_run(p_run_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  target_run public.payroll_runs%rowtype;
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to save payroll performance.';
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
end;
$function$;

alter function public.touch_updated_at() set search_path = '';

revoke all on function public.calculate_staff_take_home(numeric, numeric, numeric, boolean)
from public, anon;
revoke all on function public.lock_payroll_run(uuid)
from public, anon;
revoke all on function public.save_performance_from_run(uuid)
from public, anon;

grant execute on function public.calculate_staff_take_home(numeric, numeric, numeric, boolean)
to authenticated;
grant execute on function public.lock_payroll_run(uuid)
to authenticated;
grant execute on function public.save_performance_from_run(uuid)
to authenticated;

-- Monthly aggregates power true Staff of the Month selection.
create or replace view public.staff_monthly_performance_summary
with (security_invoker = true)
as
select
  s.id as staff_id,
  s.business_unit_id,
  bu.name as business_unit,
  s.full_name,
  s.role,
  s.tier,
  s.commission_rate,
  s.fixed_rate,
  date_trunc('month', ph.week_start)::date as month_start,
  coalesce(sum(ph.net_sales), 0::numeric) as total_net_sales,
  coalesce(sum(ph.tips), 0::numeric) as total_tips,
  coalesce(sum(ph.take_home), 0::numeric) as total_take_home,
  count(ph.id) as weeks_recorded,
  coalesce(avg(ph.net_sales), 0::numeric) as avg_weekly_net,
  max(ph.net_sales) as best_week_net,
  sum(case when ph.under_minimum then 1 else 0 end) as under_minimum_weeks,
  sum(case when ph.adjusted then 1 else 0 end) as adjusted_weeks
from public.performance_history ph
join public.staff s on s.id = ph.staff_id
left join public.business_units bu on bu.id = s.business_unit_id
group by
  s.id,
  s.business_unit_id,
  bu.name,
  s.full_name,
  s.role,
  s.tier,
  s.commission_rate,
  s.fixed_rate,
  date_trunc('month', ph.week_start)::date;

revoke all on public.staff_monthly_performance_summary from anon;
grant select on public.staff_monthly_performance_summary to authenticated;

-- Cover foreign keys and common dashboard filters.
create index if not exists staff_business_unit_id_idx
on public.staff(business_unit_id);

create index if not exists payroll_runs_business_unit_id_idx
on public.payroll_runs(business_unit_id);

create index if not exists payroll_runs_created_by_idx
on public.payroll_runs(created_by);

create index if not exists payroll_entries_payroll_run_id_idx
on public.payroll_entries(payroll_run_id);

create index if not exists payroll_entries_staff_id_idx
on public.payroll_entries(staff_id);

create index if not exists booth_rent_business_unit_id_idx
on public.booth_rent(business_unit_id);

create index if not exists booth_rent_staff_id_idx
on public.booth_rent(staff_id);

create index if not exists performance_history_business_unit_id_idx
on public.performance_history(business_unit_id);

create index if not exists performance_history_staff_id_idx
on public.performance_history(staff_id);

drop policy if exists user_profiles_self_select on public.user_profiles;
create policy user_profiles_self_select
on public.user_profiles
for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists user_profiles_self_pending_insert on public.user_profiles;
create policy user_profiles_self_pending_insert
on public.user_profiles
for insert
to authenticated
with check (
  id = (select auth.uid())
  and role = 'pending'
  and active is false
);

commit;
