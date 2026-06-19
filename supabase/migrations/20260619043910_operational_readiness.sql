begin;

-- Track whether a finalized payroll run has been copied into performance history.
alter table public.payroll_runs
  add column if not exists performance_saved_at timestamptz;

-- Permit the performance marker to be updated without weakening locked payroll immutability.
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
      if coalesce(current_setting('rtb.syncing_performance', true), '') = 'on'
        and (to_jsonb(new) - 'performance_saved_at' - 'updated_at')
          = (to_jsonb(old) - 'performance_saved_at' - 'updated_at')
      then
        return new;
      end if;

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

revoke all on function private.sync_performance_from_run(uuid)
from public, anon, authenticated;

create or replace function public.lock_payroll_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_run public.payroll_runs%rowtype;
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to finalize payroll.';
  end if;

  select pr.*
  into target_run
  from public.payroll_runs pr
  where pr.id = p_run_id
  for update;

  if target_run.id is null then
    raise exception 'Payroll run not found.';
  end if;

  if target_run.status <> 'draft' then
    raise exception 'Only draft payroll runs can be finalized.';
  end if;

  if target_run.week_start is null or target_run.week_end is null then
    raise exception 'Payroll week start and end dates are required before finalizing.';
  end if;

  if not exists (
    select 1
    from public.payroll_entries pe
    where pe.payroll_run_id = p_run_id
  ) then
    raise exception 'Add at least one staff payroll entry before finalizing.';
  end if;

  if coalesce(target_run.total_net_sales, 0) = 0
    and coalesce(target_run.owner_tips, 0) = 0
    and not exists (
      select 1
      from public.payroll_entries pe
      where pe.payroll_run_id = p_run_id
        and coalesce(pe.tips, 0) > 0
    )
  then
    raise exception 'Enter payroll sales or tips before finalizing.';
  end if;

  if exists (
    select 1
    from public.payroll_runs existing
    where existing.id <> p_run_id
      and existing.business_unit_id is not distinct from target_run.business_unit_id
      and existing.week_start is not distinct from target_run.week_start
      and existing.status in ('locked', 'sent')
  ) then
    raise exception 'A finalized payroll run already exists for this business and week.';
  end if;

  perform set_config('rtb.locking_payroll_run', 'on', true);

  update public.payroll_runs
  set status = 'locked',
      locked_at = now(),
      performance_saved_at = now(),
      updated_at = now()
  where id = p_run_id;

  perform private.sync_performance_from_run(p_run_id);
end;
$function$;

create or replace function public.save_performance_from_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to repair payroll performance.';
  end if;

  perform private.sync_performance_from_run(p_run_id);
  perform set_config('rtb.syncing_performance', 'on', true);

  update public.payroll_runs
  set performance_saved_at = now(),
      updated_at = now()
  where id = p_run_id;
end;
$function$;

revoke all on function public.lock_payroll_run(uuid)
from public, anon;
revoke all on function public.save_performance_from_run(uuid)
from public, anon;

grant execute on function public.lock_payroll_run(uuid)
to authenticated;
grant execute on function public.save_performance_from_run(uuid)
to authenticated;

-- Repair performance history for every locked run from its immutable payroll entries.
delete from public.performance_history ph
using public.payroll_runs pr
where pr.id = ph.payroll_run_id
  and pr.status = 'locked';

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
  pr.id,
  pe.staff_id,
  pr.business_unit_id,
  pr.week_label,
  pr.week_start,
  pe.net_sales,
  pe.tips,
  pe.take_home,
  pe.applied_commission_rate,
  pe.tier_snapshot,
  coalesce(pe.net_sales, 0) < 500,
  pe.adjusted
from public.payroll_runs pr
join public.payroll_entries pe on pe.payroll_run_id = pr.id
where pr.status = 'locked'
  and pe.staff_id is not null;

select set_config('rtb.syncing_performance', 'on', true);

update public.payroll_runs pr
set performance_saved_at = coalesce(
      (
        select max(ph.created_at)
        from public.performance_history ph
        where ph.payroll_run_id = pr.id
      ),
      pr.locked_at,
      pr.updated_at
    ),
    updated_at = pr.updated_at
where pr.status = 'locked';

-- The duplicate archive has stable unique IDs and should expose a primary key to tooling.
alter table private.performance_history_duplicate_archive
  alter column id set not null;

alter table private.performance_history_duplicate_archive
  add constraint performance_history_duplicate_archive_pkey primary key (id);

-- Replace overlapping permissive policies with one policy per command.
drop policy if exists business_units_admin_all on public.business_units;

create policy business_units_insert_by_admin
on public.business_units
for insert
to authenticated
with check (private.is_app_admin());

create policy business_units_update_by_admin
on public.business_units
for update
to authenticated
using (private.is_app_admin())
with check (private.is_app_admin());

create policy business_units_delete_by_admin
on public.business_units
for delete
to authenticated
using (private.is_app_admin());

drop policy if exists performance_history_admin_all on public.performance_history;

create policy performance_history_insert_by_admin
on public.performance_history
for insert
to authenticated
with check (private.is_app_admin());

create policy performance_history_update_by_admin
on public.performance_history
for update
to authenticated
using (private.is_app_admin())
with check (private.is_app_admin());

create policy performance_history_delete_by_admin
on public.performance_history
for delete
to authenticated
using (private.is_app_admin());

drop policy if exists user_profiles_admin_all on public.user_profiles;
drop policy if exists user_profiles_self_select on public.user_profiles;
drop policy if exists user_profiles_self_pending_insert on public.user_profiles;

create policy user_profiles_select_by_admin_or_self
on public.user_profiles
for select
to authenticated
using (private.is_app_admin() or id = (select auth.uid()));

create policy user_profiles_insert_by_admin_or_self
on public.user_profiles
for insert
to authenticated
with check (
  private.is_app_admin()
  or (
    id = (select auth.uid())
    and role = 'pending'
    and active is false
  )
);

create policy user_profiles_update_by_admin
on public.user_profiles
for update
to authenticated
using (private.is_app_admin())
with check (private.is_app_admin());

create policy user_profiles_delete_by_admin
on public.user_profiles
for delete
to authenticated
using (private.is_app_admin());

commit;
