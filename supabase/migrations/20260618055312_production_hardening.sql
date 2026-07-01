begin;

-- Bootstrap the production tables that existed before this hardening
-- migration was committed. These definitions are intentionally additive so a
-- fresh shadow database can replay the full migration chain, while production
-- data remains untouched when the migration has already been applied.
create extension if not exists pgcrypto;

create schema if not exists private;

create table if not exists public.business_units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  address text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'pending',
  business_unit_id uuid references public.business_units(id) on delete set null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  permissions jsonb,
  role_title text,
  role_description text,
  responsibilities jsonb not null default '[]'::jsonb,
  restrictions jsonb not null default '[]'::jsonb,
  expectations text
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  role text not null default 'Staff',
  tier text not null default 'standard',
  commission_rate numeric not null default 60,
  fixed_rate boolean not null default false,
  active boolean not null default true,
  start_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  probation_start_date date
);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete set null,
  week_label text not null,
  week_start date,
  week_end date,
  status text not null default 'draft',
  owner_net_sales numeric not null default 0,
  owner_tips numeric not null default 0,
  total_net_sales numeric not null default 0,
  total_staff_payout numeric not null default 0,
  total_deductions numeric not null default 0,
  rtb_net numeric not null default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  performance_saved_at timestamptz,
  corrected_from_run_id uuid references public.payroll_runs(id) on delete set null,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null
);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  staff_name_snapshot text not null,
  role_snapshot text,
  tier_snapshot text,
  base_commission_rate numeric not null default 60,
  applied_commission_rate numeric not null default 60,
  fixed_rate_snapshot boolean not null default false,
  adjusted boolean not null default false,
  net_sales numeric not null default 0,
  tips numeric not null default 0,
  deduction numeric not null default 5,
  take_home numeric not null default 0,
  paystub_status text not null default 'pending',
  paystub_sent_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.booth_rent (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff(id) on delete set null,
  business_unit_id uuid references public.business_units(id) on delete set null,
  renter_name text not null,
  week_label text,
  rent_amount numeric not null default 200,
  paid boolean not null default false,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.performance_history (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references public.staff(id) on delete set null,
  business_unit_id uuid references public.business_units(id) on delete set null,
  week_label text not null,
  week_start date,
  net_sales numeric not null default 0,
  tips numeric not null default 0,
  take_home numeric not null default 0,
  applied_commission_rate numeric not null default 60,
  tier text,
  under_minimum boolean not null default false,
  adjusted boolean not null default false,
  created_at timestamptz not null default now(),
  payroll_run_id uuid references public.payroll_runs(id) on delete cascade
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.business_units enable row level security;
alter table public.user_profiles enable row level security;
alter table public.staff enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.booth_rent enable row level security;
alter table public.performance_history enable row level security;
alter table public.app_settings enable row level security;

create or replace function private.permission_rank(p_level text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case lower(coalesce(p_level, 'none'))
    when 'admin' then 3
    when 'edit' then 2
    when 'view' then 1
    else 0
  end;
$function$;

create or replace function private.role_fallback_permission(p_role text, p_module text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case lower(coalesce(p_role, 'pending'))
    when 'owner' then 'admin'
    when 'admin' then 'admin'
    when 'manager' then
      case
        when p_module = 'access' then 'none'
        when p_module in ('dashboard', 'payroll', 'settings') then 'view'
        when p_module in (
          'roster',
          'performance',
          'appointments',
          'booth_rent',
          'operations'
        ) then 'edit'
        else 'none'
      end
    when 'staff' then
      case
        when p_module in ('dashboard', 'operations') then 'view'
        else 'none'
      end
    else 'none'
  end;
$function$;

create or replace function private.module_permission(p_module text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_profile public.user_profiles%rowtype;
  module_payload jsonb;
  permission text;
begin
  select *
  into current_profile
  from public.user_profiles
  where id = (select auth.uid());

  if lower(coalesce(current_profile.email, '')) = 'rickothebarber@gmail.com' then
    return 'admin';
  end if;

  if current_profile.id is null or current_profile.active is false then
    return 'none';
  end if;

  if current_profile.permissions is null then
    return private.role_fallback_permission(current_profile.role, p_module);
  end if;

  module_payload := case
    when jsonb_typeof(current_profile.permissions -> 'modules') = 'object'
      then current_profile.permissions -> 'modules'
    else current_profile.permissions
  end;
  permission := lower(coalesce(module_payload ->> p_module, 'none'));

  if permission in ('none', 'view', 'edit', 'admin') then
    return permission;
  end if;

  return 'none';
end;
$function$;

create or replace function private.can_module_view(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.permission_rank(private.module_permission(p_module)) >= 1;
$function$;

create or replace function private.can_module_edit(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.permission_rank(private.module_permission(p_module)) >= 2;
$function$;

create or replace function private.can_module_admin(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.permission_rank(private.module_permission(p_module)) >= 3;
$function$;

create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_module_admin('access')
    or private.can_module_admin('payroll')
    or exists (
      select 1
      from public.user_profiles up
      where up.id = (select auth.uid())
        and lower(up.email) = 'rickothebarber@gmail.com'
    );
$function$;

create or replace function private.can_access_business_unit(p_business_unit_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_profile public.user_profiles%rowtype;
  allowed_ids jsonb;
begin
  select *
  into current_profile
  from public.user_profiles
  where id = (select auth.uid());

  if lower(coalesce(current_profile.email, '')) = 'rickothebarber@gmail.com' then
    return true;
  end if;

  if current_profile.id is null or current_profile.active is false then
    return false;
  end if;

  if p_business_unit_id is null then
    return private.is_app_admin();
  end if;

  if current_profile.permissions is null then
    return current_profile.business_unit_id = p_business_unit_id;
  end if;

  if current_profile.permissions ->> 'business_scope' = 'all' then
    return true;
  end if;

  allowed_ids := case
    when jsonb_typeof(current_profile.permissions -> 'business_unit_ids') = 'array'
      then current_profile.permissions -> 'business_unit_ids'
    else '[]'::jsonb
  end;

  return current_profile.business_unit_id = p_business_unit_id
    or exists (
      select 1
      from jsonb_array_elements_text(allowed_ids) as allowed(id)
      where allowed.id in (p_business_unit_id::text, 'all-businesses')
    );
end;
$function$;

grant usage on schema private to authenticated;
grant execute on function private.permission_rank(text) to authenticated;
grant execute on function private.role_fallback_permission(text, text) to authenticated;
grant execute on function private.module_permission(text) to authenticated;
grant execute on function private.can_module_view(text) to authenticated;
grant execute on function private.can_module_edit(text) to authenticated;
grant execute on function private.can_module_admin(text) to authenticated;
grant execute on function private.is_app_admin() to authenticated;
grant execute on function private.can_access_business_unit(uuid) to authenticated;

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
