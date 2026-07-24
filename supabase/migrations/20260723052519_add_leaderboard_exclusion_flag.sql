begin;

alter table public.staff
  add column if not exists exclude_from_leaderboard boolean not null default false;

comment on column public.staff.exclude_from_leaderboard is
  'When true, this person''s numbers are tracked normally but excluded from the Dashboard leaderboard display. Intended for the owner or other non-competing roles.';

create or replace view public.staff_performance_summary as
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

commit;;
