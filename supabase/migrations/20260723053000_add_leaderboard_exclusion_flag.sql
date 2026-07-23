begin;

-- Lets a roster member's performance still be tracked normally
-- (payroll, performance history, their own Staff Hub view) while
-- being left out of the Dashboard leaderboard specifically. Built
-- for the owner: he wants his own numbers tracked like any staff
-- member, just not ranked against them.
alter table public.staff
  add column if not exists exclude_from_leaderboard boolean not null default false;

comment on column public.staff.exclude_from_leaderboard is
  'When true, this person''s numbers are tracked normally but excluded from the Dashboard leaderboard display. Intended for the owner or other non-competing roles.';

-- Recreate both performance-summary views to expose the flag,
-- explicitly preserving security_invoker = true on both (confirmed
-- staff_monthly_performance_summary already had this set; an
-- earlier attempt at staff_performance_summary omitted it and
-- introduced a real security_definer_view regression, caught via
-- the security advisor and fixed before this migration).
create or replace view public.staff_performance_summary
with (security_invoker = true)
as
select
  s.id as staff_id,
  ph.business_unit_id,
  bu.name as business_unit,
  s.full_name,
  s.role,
  s.tier,
  s.commission_rate,
  s.fixed_rate,
  coalesce(sum(ph.net_sales), 0::numeric) as total_net_sales,
  coalesce(sum(ph.tips), 0::numeric) as total_tips,
  coalesce(sum(ph.take_home), 0::numeric) as total_take_home,
  count(ph.id) as weeks_recorded,
  coalesce(avg(ph.net_sales), 0::numeric) as avg_weekly_net,
  max(ph.net_sales) as best_week_net,
  sum(case when ph.under_minimum then 1 else 0 end) as under_minimum_weeks,
  sum(case when ph.adjusted then 1 else 0 end) as adjusted_weeks,
  s.exclude_from_leaderboard
from public.performance_history ph
join public.staff s on s.id = ph.staff_id
left join public.business_units bu on bu.id = ph.business_unit_id
group by s.id, ph.business_unit_id, bu.name, s.full_name, s.role, s.tier, s.commission_rate, s.fixed_rate, s.exclude_from_leaderboard;

create or replace view public.staff_monthly_performance_summary
with (security_invoker = true)
as
select
  s.id as staff_id,
  ph.business_unit_id,
  bu.name as business_unit,
  s.full_name,
  s.role,
  s.tier,
  s.commission_rate,
  s.fixed_rate,
  date_trunc('month'::text, ph.week_start::timestamp with time zone)::date as month_start,
  coalesce(sum(ph.net_sales), 0::numeric) as total_net_sales,
  coalesce(sum(ph.tips), 0::numeric) as total_tips,
  coalesce(sum(ph.take_home), 0::numeric) as total_take_home,
  count(ph.id) as weeks_recorded,
  coalesce(avg(ph.net_sales), 0::numeric) as avg_weekly_net,
  max(ph.net_sales) as best_week_net,
  sum(case when ph.under_minimum then 1 else 0 end) as under_minimum_weeks,
  sum(case when ph.adjusted then 1 else 0 end) as adjusted_weeks,
  s.exclude_from_leaderboard
from public.performance_history ph
join public.staff s on s.id = ph.staff_id
left join public.business_units bu on bu.id = ph.business_unit_id
group by s.id, ph.business_unit_id, bu.name, s.full_name, s.role, s.tier, s.commission_rate, s.fixed_rate,
  (date_trunc('month'::text, ph.week_start::timestamp with time zone)::date), s.exclude_from_leaderboard;

-- Also exclude flagged staff from Staff of the Week winner
-- consideration, not just the Dashboard/Performance leaderboards --
-- otherwise the owner could still get auto-announced as the winner
-- some week, defeating the purpose of the flag.
create or replace function private.announce_staff_of_week(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  run_business_unit_id uuid;
  run_week_label text;
  hub_business_id uuid;
  winner_names text[];
  staff_count int;
  announcer_id uuid;
begin
  select business_unit_id, week_label
  into run_business_unit_id, run_week_label
  from public.payroll_runs
  where id = p_run_id;

  if run_business_unit_id is null then
    return;
  end if;

  select count(*) into staff_count
  from public.payroll_entries pe
  join public.staff s on s.id = pe.staff_id
  where pe.payroll_run_id = p_run_id
    and not coalesce(s.exclude_from_leaderboard, false);

  if staff_count < 2 then
    return;
  end if;

  select hb.id into hub_business_id
  from public.hub_businesses hb
  join public.business_units bu on lower(trim(bu.name)) = lower(trim(hb.name))
  where bu.id = run_business_unit_id;

  if hub_business_id is null then
    return;
  end if;

  select array_agg(pe.staff_name_snapshot order by pe.staff_name_snapshot)
  into winner_names
  from public.payroll_entries pe
  join public.staff s on s.id = pe.staff_id
  where pe.payroll_run_id = p_run_id
    and not coalesce(s.exclude_from_leaderboard, false)
    and pe.net_sales = (
      select max(pe2.net_sales)
      from public.payroll_entries pe2
      join public.staff s2 on s2.id = pe2.staff_id
      where pe2.payroll_run_id = p_run_id
        and not coalesce(s2.exclude_from_leaderboard, false)
    );

  if winner_names is null or array_length(winner_names, 1) = 0 then
    return;
  end if;

  announcer_id := private.hub_my_profile_id();

  insert into public.hub_announcements (business_id, title, body, category, pinned, created_by)
  values (
    hub_business_id,
    'Staff of the Week',
    case
      when array_length(winner_names, 1) = 1 then
        'Staff of the Week for ' || coalesce(run_week_label, 'this week') || ' goes to ' || winner_names[1] || '! Congratulations!'
      else
        'Staff of the Week for ' || coalesce(run_week_label, 'this week') || ' is shared by ' || array_to_string(winner_names, ', ') || '! Congratulations!'
    end,
    'event',
    true,
    announcer_id
  );
exception
  when others then
    return;
end;
$fn$;

commit;
