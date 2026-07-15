begin;

-- Staff Portal is now its own module. Staff users should not need Dashboard,
-- Roster, Payroll, or Performance module access to use their personal hub.
create or replace function private.role_fallback_permission(p_role text, p_module text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case lower(coalesce(p_role, ''))
    when 'owner' then 'admin'
    when 'admin' then 'admin'
    when 'manager' then
      case
        when p_module = 'access' then 'none'
        when p_module in ('dashboard', 'payroll', 'settings') then 'view'
        else 'edit'
      end
    when 'staff' then
      case
        when p_module = 'staff_hub' then 'view'
        else 'none'
      end
    else 'none'
  end;
$function$;

create or replace function private.has_any_module_view()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_module_view('staff_hub')
    or private.can_module_view('dashboard')
    or private.can_module_view('roster')
    or private.can_module_view('payroll')
    or private.can_module_view('performance')
    or private.can_module_view('appointments')
    or private.can_module_view('booth_rent')
    or private.can_module_view('operations')
    or private.can_module_view('access')
    or private.can_module_view('settings');
$function$;

create or replace function private.staff_portal_business_unit_ids(
  p_permissions jsonb,
  p_business_unit_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select case
    when jsonb_typeof(p_permissions -> 'business_unit_ids') = 'array'
      and jsonb_array_length(p_permissions -> 'business_unit_ids') > 0
      then p_permissions -> 'business_unit_ids'
    when p_business_unit_id is not null
      then jsonb_build_array(p_business_unit_id::text)
    else '[]'::jsonb
  end;
$function$;

with target_profiles as (
  select
    up.id,
    up.business_unit_id,
    private.staff_portal_business_unit_ids(up.permissions, up.business_unit_id) as business_unit_ids,
    case
      when up.permissions ->> 'business_scope' = 'all' then 'all'
      else 'selected'
    end as business_scope
  from public.user_profiles up
  where lower(coalesce(up.email, '')) <> 'rickothebarber@gmail.com'
    and lower(coalesce(up.role, '')) = 'staff'
    and (
      up.permissions is null
      or up.permissions ->> 'role_template' = 'staff_portal'
      or up.role_title = 'Staff Portal'
      or not exists (
        select 1
        from jsonb_each_text(
          case
            when jsonb_typeof(up.permissions -> 'modules') = 'object'
              then up.permissions -> 'modules'
            when jsonb_typeof(up.permissions) = 'object'
              then up.permissions
            else '{}'::jsonb
          end
        ) as module_access(module_id, permission_level)
        where lower(module_access.permission_level) in ('view', 'edit', 'admin')
      )
    )
)
update public.user_profiles up
set
  expectations = 'Use Staff Hub to review your own profile, earnings, performance, role expectations, and assigned business.',
  permissions = jsonb_build_object(
    'business_scope', target_profiles.business_scope,
    'business_unit_ids', case
      when target_profiles.business_scope = 'all' then jsonb_build_array('all-businesses')
      else target_profiles.business_unit_ids
    end,
    'expectations', 'Use Staff Hub to review your own profile, earnings, performance, role expectations, and assigned business.',
    'modules', jsonb_build_object(
      'staff_hub', 'view',
      'dashboard', 'none',
      'roster', 'none',
      'payroll', 'none',
      'performance', 'none',
      'appointments', 'none',
      'booth_rent', 'none',
      'operations', 'none',
      'access', 'none',
      'settings', 'none'
    ),
    'responsibilities', jsonb_build_array(
      'Review your Staff Hub updates',
      'Keep your staff profile details accurate',
      'Check your payroll and performance history',
      'Check your assigned business and role expectations',
      'Report schedule, profile, or access issues to management'
    ),
    'restrictions', jsonb_build_array(
      'No payroll editing.',
      'No access management.',
      'No business settings changes.',
      'No deleting or changing other staff records.'
    ),
    'role_description', 'Staff-only login for Staff Hub with personal payroll and performance history.',
    'role_template', 'staff_portal',
    'role_title', 'Staff Portal'
  ),
  responsibilities = jsonb_build_array(
    'Review your Staff Hub updates',
    'Keep your staff profile details accurate',
    'Check your payroll and performance history',
    'Check your assigned business and role expectations',
    'Report schedule, profile, or access issues to management'
  ),
  restrictions = jsonb_build_array(
    'No payroll editing.',
    'No access management.',
    'No business settings changes.',
    'No deleting or changing other staff records.'
  ),
  role_description = 'Staff-only login for Staff Hub with personal payroll and performance history.',
  role_title = 'Staff Portal',
  updated_at = now()
from target_profiles
where up.id = target_profiles.id;

drop function if exists private.staff_portal_business_unit_ids(jsonb, uuid);

create or replace function public.get_my_staff_portal_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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

  select ranked.rank
  into staff_rank
  from (
    select
      ph.staff_id,
      dense_rank() over (order by sum(coalesce(ph.net_sales, 0)) desc) as rank
    from public.performance_history ph
    where ph.business_unit_id is not distinct from current_staff.business_unit_id
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
$function$;

create or replace function public.update_my_staff_portal_profile(p_profile jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_profile public.user_profiles%rowtype;
  current_staff public.staff%rowtype;
  updated_staff public.staff%rowtype;
  services jsonb := '[]'::jsonb;
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
    raise exception 'No roster profile is linked to this login.';
  end if;

  if not private.can_access_business_unit(current_staff.business_unit_id) then
    raise exception 'Business access required.';
  end if;

  if jsonb_typeof(p_profile -> 'services_offered') = 'array' then
    services := p_profile -> 'services_offered';
  end if;

  update public.staff
  set
    bio = nullif(p_profile ->> 'bio', ''),
    phone = nullif(p_profile ->> 'phone', ''),
    photo_url = nullif(p_profile ->> 'photo_url', ''),
    services_offered = services,
    social_handle = nullif(p_profile ->> 'social_handle', ''),
    updated_at = now()
  where id = current_staff.id
  returning *
  into updated_staff;

  return to_jsonb(updated_staff);
end;
$function$;

revoke all on function public.get_my_staff_portal_summary() from public, anon;
grant execute on function public.get_my_staff_portal_summary() to authenticated;

revoke all on function public.update_my_staff_portal_profile(jsonb) from public, anon;
grant execute on function public.update_my_staff_portal_profile(jsonb) to authenticated;

commit;
