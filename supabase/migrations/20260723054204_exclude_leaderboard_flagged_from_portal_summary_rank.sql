create or replace function public.get_my_staff_portal_summary()
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  current_profile public.user_profiles%rowtype;
  current_staff public.staff%rowtype;
  staff_business_name text;
  payroll_entries jsonb := '[]'::jsonb;
  performance_summary jsonb := null;
  staff_rank integer := null;
begin
  select *
  into current_profile
  from public.user_profiles
  where id = (select auth.uid());

  if current_profile.id is null or current_profile.active is false then
    raise exception 'Active staff login required.';
  end if;

  if not private.can_module_view('staff_hub') and lower(coalesce(current_profile.email, '')) <> 'rickothebarber@gmail.com' then
    raise exception 'Staff Hub access required.';
  end if;

  select s.*
  into current_staff
  from public.staff s
  where lower(coalesce(s.email, '')) = lower(coalesce(current_profile.email, ''))
     or lower(coalesce(s.full_name, '')) = lower(coalesce(current_profile.full_name, ''))
  order by s.active desc, s.created_at desc
  limit 1;

  if current_staff.id is null then
    return jsonb_build_object(
      'staff_profile', null,
      'payroll_entries', '[]'::jsonb,
      'performance_summary', null
    );
  end if;

  if not private.can_access_business_unit(current_staff.business_unit_id) then
    raise exception 'Business access required.';
  end if;

  select bu.name
  into staff_business_name
  from public.business_units bu
  where bu.id = current_staff.business_unit_id;

  select coalesce(jsonb_agg(to_jsonb(entry_rows) order by entry_rows.week_start desc nulls last, entry_rows.created_at desc), '[]'::jsonb)
  into payroll_entries
  from (
    select
      pe.id,
      pe.payroll_run_id,
      pe.staff_id,
      pe.staff_name_snapshot,
      pe.role_snapshot,
      pe.tier_snapshot,
      pe.base_commission_rate,
      pe.applied_commission_rate,
      pe.fixed_rate_snapshot,
      pe.adjusted,
      pe.net_sales,
      pe.tips,
      pe.deduction,
      pe.take_home,
      pe.paystub_status,
      pe.paystub_sent_at,
      pe.notes,
      pe.created_at,
      pr.business_unit_id,
      bu.name as business_unit,
      pr.week_label,
      pr.week_start,
      pr.week_end,
      pr.status as run_status
    from public.payroll_entries pe
    join public.payroll_runs pr on pr.id = pe.payroll_run_id
    left join public.business_units bu on bu.id = pr.business_unit_id
    where (
        pe.staff_id = current_staff.id
        or lower(coalesce(pe.staff_name_snapshot, '')) = lower(coalesce(current_staff.full_name, ''))
      )
      and coalesce(pr.status, '') <> 'voided'
      and private.can_access_business_unit(pr.business_unit_id)
    order by pr.week_start desc nulls last, pe.created_at desc
    limit 36
  ) as entry_rows;

  -- Leaderboard-excluded staff (e.g. the owner, tracked but not
  -- ranked) are left out of the ranking pool entirely: they never
  -- receive a rank themselves, and everyone else's rank is computed
  -- as if they weren't in the pool at all.
  select ranked.rank
  into staff_rank
  from (
    select
      ph.staff_id,
      dense_rank() over (order by sum(coalesce(ph.net_sales, 0)) desc) as rank
    from public.performance_history ph
    join public.staff s on s.id = ph.staff_id
    where ph.business_unit_id is not distinct from current_staff.business_unit_id
      and not coalesce(s.exclude_from_leaderboard, false)
    group by ph.staff_id
  ) ranked
  where ranked.staff_id = current_staff.id;

  select jsonb_build_object(
    'staff_id', current_staff.id,
    'business_unit_id', current_staff.business_unit_id,
    'business_unit', staff_business_name,
    'full_name', current_staff.full_name,
    'role', current_staff.role,
    'tier', current_staff.tier,
    'commission_rate', current_staff.commission_rate,
    'fixed_rate', current_staff.fixed_rate,
    'total_net_sales', coalesce(sum(ph.net_sales), 0),
    'total_tips', coalesce(sum(ph.tips), 0),
    'total_take_home', coalesce(sum(ph.take_home), 0),
    'weeks_recorded', count(ph.id),
    'avg_weekly_net', coalesce(avg(ph.net_sales), 0),
    'best_week_net', coalesce(max(ph.net_sales), 0),
    'under_minimum_weeks', coalesce(sum(case when ph.under_minimum then 1 else 0 end), 0),
    'adjusted_weeks', coalesce(sum(case when ph.adjusted then 1 else 0 end), 0),
    'rank', staff_rank
  )
  into performance_summary
  from public.performance_history ph
  where ph.staff_id = current_staff.id
    and private.can_access_business_unit(ph.business_unit_id);

  return jsonb_build_object(
    'staff_profile', to_jsonb(current_staff) || jsonb_build_object('business_name', staff_business_name),
    'payroll_entries', payroll_entries,
    'performance_summary', performance_summary
  );
end;
$function$;;
