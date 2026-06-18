begin;

-- Keep employment history separate from the 90-day probation clock.
alter table public.staff
  add column if not exists probation_start_date date;

update public.staff
set probation_start_date = coalesce(start_date, created_at::date)
where tier = 'probation'
  and probation_start_date is null;

create index if not exists staff_probation_start_date_idx
on public.staff(probation_start_date)
where tier = 'probation' and active;

-- Correct the two empty June payroll records while preserving the valid run.
create temporary table invalid_payroll_runs
on commit drop
as
select pr.id, pr.business_unit_id, pr.week_start
from public.payroll_runs pr
where coalesce(pr.total_net_sales, 0) = 0
  and coalesce(pr.owner_net_sales, 0) = 0
  and exists (
    select 1
    from public.payroll_runs valid
    where valid.business_unit_id is not distinct from pr.business_unit_id
      and valid.week_start is not distinct from pr.week_start
      and valid.id <> pr.id
      and valid.status in ('locked', 'sent')
      and coalesce(valid.total_net_sales, 0) > 0
  )
  and not exists (
    select 1
    from public.payroll_entries pe
    where pe.payroll_run_id = pr.id
      and (
        coalesce(pe.net_sales, 0) <> 0
        or coalesce(pe.tips, 0) <> 0
        or coalesce(pe.take_home, 0) <> 0
      )
  );

update public.performance_history ph
set payroll_run_id = (
  select valid.id
  from public.payroll_runs valid
  join invalid_payroll_runs invalid
    on invalid.business_unit_id is not distinct from valid.business_unit_id
   and invalid.week_start is not distinct from valid.week_start
  where invalid.id = ph.payroll_run_id
    and valid.id <> invalid.id
    and valid.status in ('locked', 'sent')
    and coalesce(valid.total_net_sales, 0) > 0
  order by valid.total_net_sales desc, valid.created_at asc
  limit 1
)
where ph.payroll_run_id in (select id from invalid_payroll_runs);

alter table public.payroll_entries disable trigger protect_payroll_entry;
alter table public.payroll_runs disable trigger protect_payroll_run;

delete from public.payroll_entries
where payroll_run_id in (select id from invalid_payroll_runs);

delete from public.payroll_runs
where id in (select id from invalid_payroll_runs);

alter table public.payroll_entries enable trigger protect_payroll_entry;
alter table public.payroll_runs enable trigger protect_payroll_run;

create unique index if not exists payroll_runs_one_finalized_week
on public.payroll_runs(business_unit_id, week_start)
where status in ('locked', 'sent') and week_start is not null;

create unique index if not exists payroll_entries_one_staff_per_run
on public.payroll_entries(payroll_run_id, staff_id)
where staff_id is not null;

create index if not exists integration_connections_business_unit_id_idx
on public.integration_connections(business_unit_id);

create index if not exists integration_oauth_states_business_unit_id_idx
on public.integration_oauth_states(business_unit_id);

revoke all on table private.performance_history_duplicate_archive
from anon, authenticated;

-- Save the run and all entries in one transaction, and calculate money server-side.
create or replace function public.save_payroll_draft(
  p_run jsonb,
  p_entries jsonb
)
returns public.payroll_runs
language plpgsql
set search_path = ''
as $function$
declare
  target_id uuid;
  saved_run public.payroll_runs%rowtype;
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to save payroll.';
  end if;

  target_id := nullif(p_run ->> 'id', '')::uuid;

  if target_id is null then
    insert into public.payroll_runs (
      business_unit_id,
      week_label,
      week_start,
      week_end,
      status,
      owner_net_sales,
      owner_tips,
      notes,
      created_by,
      total_net_sales,
      total_staff_payout,
      total_deductions,
      rtb_net
    )
    values (
      nullif(p_run ->> 'business_unit_id', '')::uuid,
      coalesce(nullif(p_run ->> 'week_label', ''), 'Payroll draft'),
      nullif(p_run ->> 'week_start', '')::date,
      nullif(p_run ->> 'week_end', '')::date,
      'draft',
      coalesce(nullif(p_run ->> 'owner_net_sales', '')::numeric, 0),
      coalesce(nullif(p_run ->> 'owner_tips', '')::numeric, 0),
      nullif(p_run ->> 'notes', ''),
      nullif(p_run ->> 'created_by', '')::uuid,
      0,
      0,
      0,
      0
    )
    returning * into saved_run;

    target_id := saved_run.id;
  else
    select pr.*
    into saved_run
    from public.payroll_runs pr
    where pr.id = target_id
    for update;

    if saved_run.id is null then
      raise exception 'Payroll run not found.';
    end if;

    if saved_run.status <> 'draft' then
      raise exception 'Locked payroll runs cannot be changed.';
    end if;

    update public.payroll_runs
    set business_unit_id = nullif(p_run ->> 'business_unit_id', '')::uuid,
        week_label = coalesce(nullif(p_run ->> 'week_label', ''), week_label),
        week_start = nullif(p_run ->> 'week_start', '')::date,
        week_end = nullif(p_run ->> 'week_end', '')::date,
        owner_net_sales = coalesce(nullif(p_run ->> 'owner_net_sales', '')::numeric, 0),
        owner_tips = coalesce(nullif(p_run ->> 'owner_tips', '')::numeric, 0),
        notes = nullif(p_run ->> 'notes', ''),
        created_by = coalesce(nullif(p_run ->> 'created_by', '')::uuid, created_by),
        status = 'draft',
        updated_at = now()
    where id = target_id
    returning * into saved_run;

    delete from public.payroll_entries
    where payroll_run_id = target_id;
  end if;

  with raw_entries as (
    select
      nullif(entry ->> 'staff_id', '')::uuid as staff_id,
      coalesce(nullif(entry ->> 'staff_name_snapshot', ''), 'Staff') as staff_name,
      nullif(entry ->> 'role_snapshot', '') as role_snapshot,
      nullif(entry ->> 'tier_snapshot', '') as tier_snapshot,
      coalesce(nullif(entry ->> 'base_commission_rate', '')::numeric, 60) as base_rate,
      coalesce(nullif(entry ->> 'fixed_rate_snapshot', '')::boolean, false) as fixed_rate,
      greatest(coalesce(nullif(entry ->> 'net_sales', '')::numeric, 0), 0) as net_sales,
      greatest(coalesce(nullif(entry ->> 'tips', '')::numeric, 0), 0) as tips,
      case
        when entry ->> 'paystub_status' in ('pending', 'sent', 'failed', 'skipped')
          then entry ->> 'paystub_status'
        else 'pending'
      end as paystub_status,
      nullif(entry ->> 'notes', '') as notes
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as items(entry)
  ),
  calculated_entries as (
    select
      raw_entries.*,
      case
        when fixed_rate or net_sales >= 500 then base_rate
        else least(base_rate, 55)
      end as applied_rate
    from raw_entries
  ),
  final_entries as (
    select
      calculated_entries.*,
      least(
        5::numeric,
        greatest(0::numeric, (net_sales * applied_rate / 100) + tips)
      ) as applied_deduction
    from calculated_entries
  )
  insert into public.payroll_entries (
    payroll_run_id,
    staff_id,
    staff_name_snapshot,
    role_snapshot,
    tier_snapshot,
    base_commission_rate,
    applied_commission_rate,
    fixed_rate_snapshot,
    adjusted,
    net_sales,
    tips,
    deduction,
    take_home,
    paystub_status,
    notes
  )
  select
    target_id,
    staff_id,
    staff_name,
    role_snapshot,
    tier_snapshot,
    base_rate,
    applied_rate,
    fixed_rate,
    applied_rate <> base_rate,
    net_sales,
    tips,
    applied_deduction,
    greatest(0::numeric, (net_sales * applied_rate / 100) + tips - applied_deduction),
    paystub_status,
    notes
  from final_entries;

  with totals as (
    select
      coalesce(sum(pe.net_sales), 0) as staff_sales,
      coalesce(sum(pe.net_sales * pe.applied_commission_rate / 100), 0) as commission_total,
      coalesce(sum(pe.deduction), 0) as deduction_total,
      coalesce(sum(pe.take_home), 0) as payout_total
    from public.payroll_entries pe
    where pe.payroll_run_id = target_id
  )
  update public.payroll_runs pr
  set total_net_sales = coalesce(pr.owner_net_sales, 0) + totals.staff_sales,
      total_staff_payout = totals.payout_total,
      total_deductions = totals.deduction_total,
      rtb_net = coalesce(pr.owner_net_sales, 0)
        + totals.staff_sales
        - totals.commission_total
        + totals.deduction_total,
      updated_at = now()
  from totals
  where pr.id = target_id
  returning pr.* into saved_run;

  return saved_run;
end;
$function$;

revoke all on function public.save_payroll_draft(jsonb, jsonb)
from public, anon;

grant execute on function public.save_payroll_draft(jsonb, jsonb)
to authenticated;

create or replace function public.lock_payroll_run(p_run_id uuid)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  target_run public.payroll_runs%rowtype;
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to lock payroll.';
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
    raise exception 'Only draft payroll runs can be locked.';
  end if;

  if target_run.week_start is null or target_run.week_end is null then
    raise exception 'Payroll week start and end dates are required before locking.';
  end if;

  if not exists (
    select 1
    from public.payroll_entries pe
    where pe.payroll_run_id = p_run_id
  ) then
    raise exception 'Add at least one staff payroll entry before locking.';
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
    raise exception 'Enter payroll sales or tips before locking.';
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
      updated_at = now()
  where id = p_run_id;
end;
$function$;

revoke all on function public.lock_payroll_run(uuid)
from public, anon;

grant execute on function public.lock_payroll_run(uuid)
to authenticated;

commit;
