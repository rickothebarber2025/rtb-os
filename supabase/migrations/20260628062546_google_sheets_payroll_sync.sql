begin;

create table if not exists public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null
    references public.business_units(id)
    on delete cascade,
  payroll_run_id uuid
    references public.payroll_runs(id)
    on delete set null,
  payroll_entry_id uuid
    references public.payroll_entries(id)
    on delete set null,
  business_name text,
  week_label text not null,
  week_start date not null,
  week_end date not null,
  staff_id uuid
    references public.staff(id)
    on delete set null,
  staff_name text not null,
  staff_name_key text generated always as (lower(btrim(staff_name))) stored,
  role_snapshot text,
  tier_snapshot text,
  base_commission_rate numeric(6, 2) not null default 60,
  applied_commission_rate numeric(6, 2) not null default 60,
  fixed_rate_snapshot boolean not null default false,
  adjusted boolean not null default false,
  net_sales numeric(12, 2) not null default 0,
  tips numeric(12, 2) not null default 0,
  deduction numeric(12, 2) not null default 0,
  take_home numeric(12, 2) not null default 0,
  paystub_status text not null default 'sent',
  notes text,
  source_row jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_records_date_order check (week_end >= week_start),
  constraint payroll_records_staff_name_present check (length(btrim(staff_name)) > 0),
  constraint payroll_records_paystub_status_check
    check (paystub_status in ('pending', 'sent', 'failed', 'skipped')),
  constraint payroll_records_nonnegative_amounts check (
    net_sales >= 0
    and tips >= 0
    and deduction >= 0
    and take_home >= 0
  )
);

create unique index if not exists payroll_records_business_week_staff_unique
on public.payroll_records(business_unit_id, week_start, week_end, staff_name_key);

create index if not exists payroll_records_business_unit_id_idx
on public.payroll_records(business_unit_id);

create index if not exists payroll_records_payroll_run_id_idx
on public.payroll_records(payroll_run_id);

create index if not exists payroll_records_staff_id_idx
on public.payroll_records(staff_id);

alter table public.payroll_records enable row level security;

drop policy if exists payroll_records_select_by_business_access on public.payroll_records;
create policy payroll_records_select_by_business_access
on public.payroll_records
for select
to authenticated
using (private.can_access_business_unit(business_unit_id));

drop policy if exists payroll_records_admin_insert on public.payroll_records;
create policy payroll_records_admin_insert
on public.payroll_records
for insert
to authenticated
with check (private.is_app_admin());

drop policy if exists payroll_records_admin_update on public.payroll_records;
create policy payroll_records_admin_update
on public.payroll_records
for update
to authenticated
using (private.is_app_admin())
with check (private.is_app_admin());

drop policy if exists payroll_records_admin_delete on public.payroll_records;
create policy payroll_records_admin_delete
on public.payroll_records
for delete
to authenticated
using (private.is_app_admin());

grant select on public.payroll_records to authenticated;
grant all on public.payroll_records to service_role;

create or replace function private.protect_payroll_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if coalesce(current_setting('rtb.sheet_syncing_payroll', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' and old.status in ('locked', 'sent', 'voided') then
    raise exception 'Finalized payroll runs cannot be deleted.';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('locked', 'sent') then
      if old.status = 'locked'
        and coalesce(current_setting('rtb.syncing_performance', true), '') = 'on'
        and (to_jsonb(new) - 'performance_saved_at' - 'updated_at')
          = (to_jsonb(old) - 'performance_saved_at' - 'updated_at')
      then
        return new;
      end if;

      if coalesce(current_setting('rtb.voiding_payroll_run', true), '') = 'on'
        and new.status = 'voided'
        and (
          to_jsonb(new)
            - 'status'
            - 'performance_saved_at'
            - 'updated_at'
            - 'void_reason'
            - 'voided_at'
            - 'voided_by'
        ) = (
          to_jsonb(old)
            - 'status'
            - 'performance_saved_at'
            - 'updated_at'
            - 'void_reason'
            - 'voided_at'
            - 'voided_by'
        )
      then
        return new;
      end if;

      raise exception 'Locked payroll runs cannot be changed. Use the correction workflow.';
    end if;

    if old.status = 'voided' then
      raise exception 'Voided payroll runs cannot be changed.';
    end if;

    if new.status in ('locked', 'sent')
      and coalesce(current_setting('rtb.locking_payroll_run', true), '') <> 'on'
    then
      raise exception 'Use lock_payroll_run() to finalize payroll.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

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
  if coalesce(current_setting('rtb.sheet_syncing_payroll', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;

    return new;
  end if;

  target_run_id := case
    when tg_op = 'DELETE' then old.payroll_run_id
    else new.payroll_run_id
  end;

  select pr.status
  into target_status
  from public.payroll_runs pr
  where pr.id = target_run_id;

  if target_status in ('locked', 'sent', 'voided') then
    raise exception 'Entries in a finalized payroll run cannot be changed.';
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

  if target_run.status not in ('locked', 'sent') then
    raise exception 'Finalize payroll before saving performance.';
  end if;

  delete from public.performance_history ph
  where ph.payroll_run_id = p_run_id
    or (
      ph.business_unit_id is not distinct from target_run.business_unit_id
      and ph.week_start is not distinct from target_run.week_start
      and ph.staff_id in (
        select pe.staff_id
        from public.payroll_entries pe
        where pe.payroll_run_id = p_run_id
          and pe.staff_id is not null
      )
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

grant execute on function private.sync_performance_from_run(uuid)
to authenticated, service_role;

create or replace function public.sync_google_sheets_payroll(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  applied_rate numeric;
  base_rate numeric;
  business_id uuid;
  business_record public.business_units%rowtype;
  deduction_amount numeric;
  entry_id uuid;
  fixed_rate boolean;
  inserted_runs integer := 0;
  net_sales_amount numeric;
  normalized_count integer := 0;
  owner_sales_amount numeric;
  owner_tips_amount numeric;
  performance_count integer := 0;
  raw_row jsonb;
  record_id uuid;
  run_id uuid;
  row_number integer := 1;
  row_record record;
  staff_name_value text;
  staff_record public.staff%rowtype;
  synced_runs integer := 0;
  take_home_amount numeric;
  target_status text;
  tips_amount numeric;
  week_group record;
  week_end_value date;
  week_label_value text;
  week_start_value date;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Rows payload must be an array.';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception 'No payroll rows were provided.';
  end if;

  drop table if exists pg_temp.sheet_payroll_sync_rows;
  create temporary table pg_temp.sheet_payroll_sync_rows (
    record_id uuid not null,
    business_unit_id uuid not null,
    business_name text,
    week_label text not null,
    week_start date not null,
    week_end date not null,
    staff_id uuid,
    staff_name text not null,
    role_snapshot text,
    tier_snapshot text,
    base_commission_rate numeric not null,
    applied_commission_rate numeric not null,
    fixed_rate_snapshot boolean not null,
    adjusted boolean not null,
    net_sales numeric not null,
    tips numeric not null,
    deduction numeric not null,
    take_home numeric not null,
    paystub_status text not null,
    notes text,
    owner_net_sales numeric not null default 0,
    owner_tips numeric not null default 0
  ) on commit drop;

  for raw_row in
    select value
    from jsonb_array_elements(p_rows)
  loop
    business_id := nullif(raw_row ->> 'business_unit_id', '')::uuid;

    if business_id is not null then
      select bu.*
      into business_record
      from public.business_units bu
      where bu.id = business_id;
    else
      select bu.*
      into business_record
      from public.business_units bu
      where lower(btrim(bu.name)) = lower(btrim(coalesce(
        nullif(raw_row ->> 'business_unit_name', ''),
        nullif(raw_row ->> 'business_unit', ''),
        nullif(raw_row ->> 'business', ''),
        nullif(raw_row ->> 'location', '')
      )))
      limit 1;
    end if;

    if business_record.id is null then
      raise exception 'Row % is missing a valid business unit.', row_number;
    end if;

    staff_name_value := btrim(coalesce(
      nullif(raw_row ->> 'staff_name', ''),
      nullif(raw_row ->> 'employee_name', ''),
      nullif(raw_row ->> 'team_member', ''),
      nullif(raw_row ->> 'name', '')
    ));

    if staff_name_value = '' then
      raise exception 'Row % is missing staff_name.', row_number;
    end if;

    week_start_value := nullif(raw_row ->> 'week_start', '')::date;
    week_end_value := nullif(raw_row ->> 'week_end', '')::date;

    if week_start_value is null or week_end_value is null then
      raise exception 'Row % is missing week_start or week_end.', row_number;
    end if;

    if week_end_value < week_start_value then
      raise exception 'Row % has week_end before week_start.', row_number;
    end if;

    select s.*
    into staff_record
    from public.staff s
    where s.business_unit_id = business_record.id
      and lower(btrim(s.full_name)) = lower(staff_name_value)
    order by s.active desc, s.updated_at desc nulls last, s.created_at desc nulls last
    limit 1;

    net_sales_amount := greatest(coalesce(nullif(raw_row ->> 'net_sales', '')::numeric, 0), 0);
    tips_amount := greatest(coalesce(nullif(raw_row ->> 'tips', '')::numeric, 0), 0);
    owner_sales_amount := greatest(coalesce(nullif(raw_row ->> 'owner_net_sales', '')::numeric, 0), 0);
    owner_tips_amount := greatest(coalesce(nullif(raw_row ->> 'owner_tips', '')::numeric, 0), 0);
    fixed_rate := coalesce(
      nullif(raw_row ->> 'fixed_rate', '')::boolean,
      staff_record.fixed_rate,
      false
    );
    base_rate := coalesce(
      nullif(raw_row ->> 'base_commission_rate', '')::numeric,
      nullif(raw_row ->> 'commission_rate', '')::numeric,
      staff_record.commission_rate,
      60
    );
    applied_rate := coalesce(
      nullif(raw_row ->> 'applied_commission_rate', '')::numeric,
      case
        when fixed_rate or net_sales_amount >= 500 then base_rate
        else least(base_rate, 55)
      end
    );
    deduction_amount := coalesce(
      nullif(raw_row ->> 'deduction', '')::numeric,
      least(5::numeric, greatest(0::numeric, (net_sales_amount * applied_rate / 100) + tips_amount))
    );
    take_home_amount := coalesce(
      nullif(raw_row ->> 'take_home', '')::numeric,
      greatest(0::numeric, (net_sales_amount * applied_rate / 100) + tips_amount - deduction_amount)
    );
    week_label_value := coalesce(
      nullif(raw_row ->> 'week_label', ''),
      to_char(week_start_value, 'Mon FMDD') || ' - ' || to_char(week_end_value, 'Mon FMDD, YYYY')
    );

    insert into public.payroll_records (
      business_unit_id,
      business_name,
      week_label,
      week_start,
      week_end,
      staff_id,
      staff_name,
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
      notes,
      source_row,
      synced_at,
      updated_at
    )
    values (
      business_record.id,
      business_record.name,
      week_label_value,
      week_start_value,
      week_end_value,
      staff_record.id,
      staff_name_value,
      coalesce(nullif(raw_row ->> 'role_snapshot', ''), nullif(raw_row ->> 'role', ''), staff_record.role),
      coalesce(nullif(raw_row ->> 'tier_snapshot', ''), nullif(raw_row ->> 'tier', ''), staff_record.tier),
      base_rate,
      applied_rate,
      fixed_rate,
      applied_rate <> base_rate,
      net_sales_amount,
      tips_amount,
      deduction_amount,
      take_home_amount,
      case
        when raw_row ->> 'paystub_status' in ('pending', 'sent', 'failed', 'skipped')
          then raw_row ->> 'paystub_status'
        else 'sent'
      end,
      nullif(raw_row ->> 'notes', ''),
      coalesce(raw_row -> 'source_row', raw_row),
      now(),
      now()
    )
    on conflict (business_unit_id, week_start, week_end, staff_name_key)
    do update set
      business_name = excluded.business_name,
      week_label = excluded.week_label,
      staff_id = excluded.staff_id,
      role_snapshot = excluded.role_snapshot,
      tier_snapshot = excluded.tier_snapshot,
      base_commission_rate = excluded.base_commission_rate,
      applied_commission_rate = excluded.applied_commission_rate,
      fixed_rate_snapshot = excluded.fixed_rate_snapshot,
      adjusted = excluded.adjusted,
      net_sales = excluded.net_sales,
      tips = excluded.tips,
      deduction = excluded.deduction,
      take_home = excluded.take_home,
      paystub_status = excluded.paystub_status,
      notes = excluded.notes,
      source_row = excluded.source_row,
      synced_at = now(),
      updated_at = now()
    returning id into record_id;

    insert into pg_temp.sheet_payroll_sync_rows (
      record_id,
      business_unit_id,
      business_name,
      week_label,
      week_start,
      week_end,
      staff_id,
      staff_name,
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
      notes,
      owner_net_sales,
      owner_tips
    )
    values (
      record_id,
      business_record.id,
      business_record.name,
      week_label_value,
      week_start_value,
      week_end_value,
      staff_record.id,
      staff_name_value,
      coalesce(nullif(raw_row ->> 'role_snapshot', ''), nullif(raw_row ->> 'role', ''), staff_record.role),
      coalesce(nullif(raw_row ->> 'tier_snapshot', ''), nullif(raw_row ->> 'tier', ''), staff_record.tier),
      base_rate,
      applied_rate,
      fixed_rate,
      applied_rate <> base_rate,
      net_sales_amount,
      tips_amount,
      deduction_amount,
      take_home_amount,
      case
        when raw_row ->> 'paystub_status' in ('pending', 'sent', 'failed', 'skipped')
          then raw_row ->> 'paystub_status'
        else 'sent'
      end,
      nullif(raw_row ->> 'notes', ''),
      owner_sales_amount,
      owner_tips_amount
    );

    normalized_count := normalized_count + 1;
    row_number := row_number + 1;
    staff_record := null;
    business_record := null;
  end loop;

  for week_group in
    select
      business_unit_id,
      max(business_name) as business_name,
      week_start,
      week_end,
      max(week_label) as week_label,
      max(owner_net_sales) as owner_net_sales,
      max(owner_tips) as owner_tips
    from pg_temp.sheet_payroll_sync_rows
    group by business_unit_id, week_start, week_end
  loop
    select pr.id, pr.status
    into run_id, target_status
    from public.payroll_runs pr
    where pr.business_unit_id = week_group.business_unit_id
      and pr.week_start = week_group.week_start
      and pr.week_end = week_group.week_end
      and pr.status <> 'voided'
    order by
      case pr.status
        when 'locked' then 1
        when 'sent' then 2
        when 'draft' then 3
        else 4
      end,
      pr.created_at desc
    limit 1
    for update;

    if run_id is null then
      insert into public.payroll_runs (
        business_unit_id,
        week_label,
        week_start,
        week_end,
        status,
        owner_net_sales,
        owner_tips,
        notes,
        total_net_sales,
        total_staff_payout,
        total_deductions,
        rtb_net
      )
      values (
        week_group.business_unit_id,
        week_group.week_label,
        week_group.week_start,
        week_group.week_end,
        'draft',
        week_group.owner_net_sales,
        week_group.owner_tips,
        'Imported from Google Sheets payroll workbook.',
        0,
        0,
        0,
        0
      )
      returning id, status into run_id, target_status;

      inserted_runs := inserted_runs + 1;
    end if;

    perform set_config('rtb.sheet_syncing_payroll', 'on', true);

    delete from public.performance_history
    where payroll_run_id = run_id;

    delete from public.payroll_entries
    where payroll_run_id = run_id;

    for row_record in
      select *
      from pg_temp.sheet_payroll_sync_rows rows
      where rows.business_unit_id = week_group.business_unit_id
        and rows.week_start = week_group.week_start
        and rows.week_end = week_group.week_end
      order by rows.staff_name
    loop
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
      values (
        run_id,
        row_record.staff_id,
        row_record.staff_name,
        row_record.role_snapshot,
        row_record.tier_snapshot,
        row_record.base_commission_rate,
        row_record.applied_commission_rate,
        row_record.fixed_rate_snapshot,
        row_record.adjusted,
        row_record.net_sales,
        row_record.tips,
        row_record.deduction,
        row_record.take_home,
        row_record.paystub_status,
        row_record.notes
      )
      returning id into entry_id;

      update public.payroll_records
      set payroll_run_id = run_id,
          payroll_entry_id = entry_id,
          updated_at = now()
      where id = row_record.record_id;
    end loop;

    with totals as (
      select
        coalesce(sum(pe.net_sales), 0) as staff_sales,
        coalesce(sum(pe.net_sales * pe.applied_commission_rate / 100), 0) as commission_total,
        coalesce(sum(pe.deduction), 0) as deduction_total,
        coalesce(sum(pe.take_home), 0) as payout_total
      from public.payroll_entries pe
      where pe.payroll_run_id = run_id
    )
    update public.payroll_runs pr
    set week_label = week_group.week_label,
        week_start = week_group.week_start,
        week_end = week_group.week_end,
        owner_net_sales = week_group.owner_net_sales,
        owner_tips = week_group.owner_tips,
        status = case when target_status = 'sent' then 'sent' else 'locked' end,
        locked_at = coalesce(pr.locked_at, now()),
        performance_saved_at = now(),
        total_net_sales = week_group.owner_net_sales + totals.staff_sales,
        total_staff_payout = totals.payout_total,
        total_deductions = totals.deduction_total,
        rtb_net = week_group.owner_net_sales
          + totals.staff_sales
          - totals.commission_total
          + totals.deduction_total,
        notes = coalesce(nullif(pr.notes, ''), 'Imported from Google Sheets payroll workbook.'),
        updated_at = now()
    from totals
    where pr.id = run_id;

    performance_count := performance_count + private.sync_performance_from_run(run_id);
    synced_runs := synced_runs + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'records_upserted', normalized_count,
    'runs_inserted', inserted_runs,
    'runs_synced', synced_runs,
    'performance_rows', performance_count
  );
end;
$function$;

revoke all on function public.sync_google_sheets_payroll(jsonb)
from public, anon, authenticated;

grant execute on function public.sync_google_sheets_payroll(jsonb)
to service_role;

commit;
