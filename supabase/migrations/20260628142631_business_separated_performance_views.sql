begin;

-- Attribute performance to the payroll/performance business, not only the
-- staff member's primary roster business. This keeps Staff of the Month and
-- rankings separate when a staff member works in both RTB businesses.
drop view if exists public.staff_monthly_performance_summary;
drop view if exists public.staff_performance_summary;

create view public.staff_performance_summary
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
  sum(case when ph.adjusted then 1 else 0 end) as adjusted_weeks
from public.performance_history ph
join public.staff s on s.id = ph.staff_id
left join public.business_units bu on bu.id = ph.business_unit_id
group by
  s.id,
  ph.business_unit_id,
  bu.name,
  s.full_name,
  s.role,
  s.tier,
  s.commission_rate,
  s.fixed_rate;

create view public.staff_monthly_performance_summary
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
left join public.business_units bu on bu.id = ph.business_unit_id
group by
  s.id,
  ph.business_unit_id,
  bu.name,
  s.full_name,
  s.role,
  s.tier,
  s.commission_rate,
  s.fixed_rate,
  date_trunc('month', ph.week_start)::date;

revoke all on public.staff_performance_summary from anon;
revoke all on public.staff_monthly_performance_summary from anon;
grant select on public.staff_performance_summary to authenticated;
grant select on public.staff_monthly_performance_summary to authenticated;

commit;
