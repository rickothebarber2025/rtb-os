begin;

alter table public.user_profiles
  add column if not exists role_title text,
  add column if not exists role_description text,
  add column if not exists responsibilities jsonb not null default '[]'::jsonb,
  add column if not exists restrictions jsonb not null default '[]'::jsonb,
  add column if not exists expectations text;

alter table public.user_profiles
  alter column responsibilities set default '[]'::jsonb,
  alter column restrictions set default '[]'::jsonb;

update public.user_profiles
set
  role_title = coalesce(
    nullif(role_title, ''),
    nullif(permissions ->> 'role_title', ''),
    case lower(coalesce(role, 'pending'))
      when 'admin' then 'Full Admin'
      when 'manager' then 'Manager'
      when 'staff' then 'Staff'
      else 'Custom Role'
    end
  ),
  role_description = coalesce(
    nullif(role_description, ''),
    nullif(permissions ->> 'role_description', ''),
    'Custom access profile.'
  ),
  responsibilities = case
    when jsonb_typeof(responsibilities) = 'array' and jsonb_array_length(responsibilities) > 0
      then responsibilities
    when jsonb_typeof(permissions -> 'responsibilities') = 'array'
      then permissions -> 'responsibilities'
    else '[]'::jsonb
  end,
  restrictions = case
    when jsonb_typeof(restrictions) = 'array' and jsonb_array_length(restrictions) > 0
      then restrictions
    when jsonb_typeof(permissions -> 'restrictions') = 'array'
      then permissions -> 'restrictions'
    else '[]'::jsonb
  end,
  expectations = coalesce(
    nullif(expectations, ''),
    nullif(permissions ->> 'expectations', '')
  )
where permissions is not null
   or role_title is null
   or role_description is null;

update public.user_profiles
set permissions = jsonb_strip_nulls(
  coalesce(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'role_title', role_title,
    'role_description', role_description,
    'responsibilities', responsibilities,
    'restrictions', restrictions,
    'expectations', expectations
  )
)
where permissions is not null;

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

create or replace function private.has_any_module_view()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_module_view('dashboard')
    or private.can_module_view('roster')
    or private.can_module_view('payroll')
    or private.can_module_view('performance')
    or private.can_module_view('appointments')
    or private.can_module_view('booth_rent')
    or private.can_module_view('operations')
    or private.can_module_view('access')
    or private.can_module_view('settings');
$function$;

create or replace function private.can_app_settings_edit()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_module_edit('settings')
    or private.can_module_edit('operations')
    or private.can_module_edit('appointments')
    or private.can_module_edit('roster');
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
grant execute on function private.has_any_module_view() to authenticated;
grant execute on function private.can_app_settings_edit() to authenticated;
grant execute on function private.is_app_admin() to authenticated;
grant execute on function private.can_access_business_unit(uuid) to authenticated;

alter table public.business_units enable row level security;
alter table public.user_profiles enable row level security;
alter table public.staff enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.booth_rent enable row level security;
alter table public.performance_history enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists business_units_admin_all on public.business_units;
drop policy if exists business_units_insert_by_admin on public.business_units;
drop policy if exists business_units_update_by_admin on public.business_units;
drop policy if exists business_units_delete_by_admin on public.business_units;
drop policy if exists business_units_read_by_dashboard_or_roster on public.business_units;
drop policy if exists business_units_insert_by_dashboard_or_roster_edit on public.business_units;
drop policy if exists business_units_update_by_dashboard_or_roster_edit on public.business_units;
drop policy if exists business_units_delete_by_dashboard_or_roster_admin on public.business_units;

create policy business_units_read_by_dashboard_or_roster
on public.business_units
for select
to authenticated
using (
  (
    private.can_module_view('dashboard')
    or private.can_module_view('roster')
    or private.can_module_view('access')
  )
  and private.can_access_business_unit(id)
);

create policy business_units_insert_by_dashboard_or_roster_edit
on public.business_units
for insert
to authenticated
with check (
  (
    private.can_module_edit('dashboard')
    or private.can_module_edit('roster')
    or private.can_module_admin('access')
  )
  and private.can_access_business_unit(id)
);

create policy business_units_update_by_dashboard_or_roster_edit
on public.business_units
for update
to authenticated
using (
  (
    private.can_module_edit('dashboard')
    or private.can_module_edit('roster')
    or private.can_module_admin('access')
  )
  and private.can_access_business_unit(id)
)
with check (
  (
    private.can_module_edit('dashboard')
    or private.can_module_edit('roster')
    or private.can_module_admin('access')
  )
  and private.can_access_business_unit(id)
);

create policy business_units_delete_by_dashboard_or_roster_admin
on public.business_units
for delete
to authenticated
using (
  (
    private.can_module_admin('dashboard')
    or private.can_module_admin('roster')
    or private.can_module_admin('access')
  )
  and private.can_access_business_unit(id)
);

drop policy if exists staff_admin_all on public.staff;
drop policy if exists staff_insert_by_manager_or_admin on public.staff;
drop policy if exists staff_update_by_manager_or_admin on public.staff;
drop policy if exists staff_delete_by_admin on public.staff;
drop policy if exists staff_read_by_roster on public.staff;
drop policy if exists staff_insert_by_roster_edit on public.staff;
drop policy if exists staff_update_by_roster_edit on public.staff;
drop policy if exists staff_delete_by_roster_admin on public.staff;

create policy staff_read_by_roster
on public.staff
for select
to authenticated
using (
  private.can_module_view('roster')
  and private.can_access_business_unit(business_unit_id)
);

create policy staff_insert_by_roster_edit
on public.staff
for insert
to authenticated
with check (
  private.can_module_edit('roster')
  and private.can_access_business_unit(business_unit_id)
);

create policy staff_update_by_roster_edit
on public.staff
for update
to authenticated
using (
  private.can_module_edit('roster')
  and private.can_access_business_unit(business_unit_id)
)
with check (
  private.can_module_edit('roster')
  and private.can_access_business_unit(business_unit_id)
);

create policy staff_delete_by_roster_admin
on public.staff
for delete
to authenticated
using (
  private.can_module_admin('roster')
  and private.can_access_business_unit(business_unit_id)
);

drop policy if exists payroll_runs_read on public.payroll_runs;
drop policy if exists payroll_runs_insert on public.payroll_runs;
drop policy if exists payroll_runs_update on public.payroll_runs;
drop policy if exists payroll_runs_delete on public.payroll_runs;

create policy payroll_runs_read
on public.payroll_runs
for select
to authenticated
using (
  private.can_module_view('payroll')
  and private.can_access_business_unit(business_unit_id)
);

create policy payroll_runs_insert
on public.payroll_runs
for insert
to authenticated
with check (
  private.can_module_edit('payroll')
  and private.can_access_business_unit(business_unit_id)
);

create policy payroll_runs_update
on public.payroll_runs
for update
to authenticated
using (
  private.can_module_edit('payroll')
  and private.can_access_business_unit(business_unit_id)
)
with check (
  private.can_module_edit('payroll')
  and private.can_access_business_unit(business_unit_id)
);

create policy payroll_runs_delete
on public.payroll_runs
for delete
to authenticated
using (
  private.can_module_admin('payroll')
  and private.can_access_business_unit(business_unit_id)
);

drop policy if exists payroll_entries_read on public.payroll_entries;
drop policy if exists payroll_entries_insert on public.payroll_entries;
drop policy if exists payroll_entries_update on public.payroll_entries;
drop policy if exists payroll_entries_delete on public.payroll_entries;

create policy payroll_entries_read
on public.payroll_entries
for select
to authenticated
using (
  private.can_module_view('payroll')
  and exists (
    select 1
    from public.payroll_runs pr
    where pr.id = payroll_entries.payroll_run_id
      and private.can_access_business_unit(pr.business_unit_id)
  )
);

create policy payroll_entries_insert
on public.payroll_entries
for insert
to authenticated
with check (
  private.can_module_edit('payroll')
  and exists (
    select 1
    from public.payroll_runs pr
    where pr.id = payroll_entries.payroll_run_id
      and private.can_access_business_unit(pr.business_unit_id)
  )
);

create policy payroll_entries_update
on public.payroll_entries
for update
to authenticated
using (
  private.can_module_edit('payroll')
  and exists (
    select 1
    from public.payroll_runs pr
    where pr.id = payroll_entries.payroll_run_id
      and private.can_access_business_unit(pr.business_unit_id)
  )
)
with check (
  private.can_module_edit('payroll')
  and exists (
    select 1
    from public.payroll_runs pr
    where pr.id = payroll_entries.payroll_run_id
      and private.can_access_business_unit(pr.business_unit_id)
  )
);

create policy payroll_entries_delete
on public.payroll_entries
for delete
to authenticated
using (
  private.can_module_admin('payroll')
  and exists (
    select 1
    from public.payroll_runs pr
    where pr.id = payroll_entries.payroll_run_id
      and private.can_access_business_unit(pr.business_unit_id)
  )
);

drop policy if exists performance_history_admin_all on public.performance_history;
drop policy if exists performance_history_insert_by_admin on public.performance_history;
drop policy if exists performance_history_update_by_admin on public.performance_history;
drop policy if exists performance_history_delete_by_admin on public.performance_history;
drop policy if exists performance_history_read on public.performance_history;
drop policy if exists performance_history_insert on public.performance_history;
drop policy if exists performance_history_update on public.performance_history;
drop policy if exists performance_history_delete on public.performance_history;

create policy performance_history_read
on public.performance_history
for select
to authenticated
using (
  private.can_module_view('performance')
  and private.can_access_business_unit(business_unit_id)
);

create policy performance_history_insert
on public.performance_history
for insert
to authenticated
with check (
  private.can_module_edit('performance')
  and private.can_access_business_unit(business_unit_id)
);

create policy performance_history_update
on public.performance_history
for update
to authenticated
using (
  private.can_module_edit('performance')
  and private.can_access_business_unit(business_unit_id)
)
with check (
  private.can_module_edit('performance')
  and private.can_access_business_unit(business_unit_id)
);

create policy performance_history_delete
on public.performance_history
for delete
to authenticated
using (
  private.can_module_admin('performance')
  and private.can_access_business_unit(business_unit_id)
);

drop policy if exists booth_rent_read on public.booth_rent;
drop policy if exists booth_rent_insert on public.booth_rent;
drop policy if exists booth_rent_update on public.booth_rent;
drop policy if exists booth_rent_delete on public.booth_rent;

create policy booth_rent_read
on public.booth_rent
for select
to authenticated
using (
  private.can_module_view('booth_rent')
  and private.can_access_business_unit(business_unit_id)
);

create policy booth_rent_insert
on public.booth_rent
for insert
to authenticated
with check (
  private.can_module_edit('booth_rent')
  and private.can_access_business_unit(business_unit_id)
);

create policy booth_rent_update
on public.booth_rent
for update
to authenticated
using (
  private.can_module_edit('booth_rent')
  and private.can_access_business_unit(business_unit_id)
)
with check (
  private.can_module_edit('booth_rent')
  and private.can_access_business_unit(business_unit_id)
);

create policy booth_rent_delete
on public.booth_rent
for delete
to authenticated
using (
  private.can_module_admin('booth_rent')
  and private.can_access_business_unit(business_unit_id)
);

drop policy if exists app_settings_read_by_settings on public.app_settings;
drop policy if exists app_settings_insert_by_settings on public.app_settings;
drop policy if exists app_settings_update_by_settings on public.app_settings;
drop policy if exists app_settings_delete_by_settings_admin on public.app_settings;
drop policy if exists app_settings_read_by_any_assigned_module on public.app_settings;
drop policy if exists app_settings_insert_by_related_module on public.app_settings;
drop policy if exists app_settings_update_by_related_module on public.app_settings;

create policy app_settings_read_by_any_assigned_module
on public.app_settings
for select
to authenticated
using (private.has_any_module_view());

create policy app_settings_insert_by_related_module
on public.app_settings
for insert
to authenticated
with check (private.can_app_settings_edit());

create policy app_settings_update_by_related_module
on public.app_settings
for update
to authenticated
using (private.can_app_settings_edit())
with check (private.can_app_settings_edit());

create policy app_settings_delete_by_settings_admin
on public.app_settings
for delete
to authenticated
using (private.can_module_admin('settings'));

drop policy if exists user_profiles_admin_all on public.user_profiles;
drop policy if exists user_profiles_self_select on public.user_profiles;
drop policy if exists user_profiles_self_pending_insert on public.user_profiles;
drop policy if exists user_profiles_select_by_admin_or_self on public.user_profiles;
drop policy if exists user_profiles_insert_by_admin_or_self on public.user_profiles;
drop policy if exists user_profiles_update_by_admin on public.user_profiles;
drop policy if exists user_profiles_delete_by_admin on public.user_profiles;
drop policy if exists user_profiles_select_by_self_or_access_admin on public.user_profiles;
drop policy if exists user_profiles_insert_by_self_pending on public.user_profiles;
drop policy if exists user_profiles_update_by_access_admin on public.user_profiles;
drop policy if exists user_profiles_delete_by_access_admin on public.user_profiles;

create policy user_profiles_select_by_self_or_access_admin
on public.user_profiles
for select
to authenticated
using (id = (select auth.uid()) or private.can_module_admin('access'));

create policy user_profiles_insert_by_self_pending
on public.user_profiles
for insert
to authenticated
with check (
  id = (select auth.uid())
  and role = 'pending'
  and active is false
);

create policy user_profiles_update_by_access_admin
on public.user_profiles
for update
to authenticated
using (private.can_module_admin('access'))
with check (private.can_module_admin('access'));

create policy user_profiles_delete_by_access_admin
on public.user_profiles
for delete
to authenticated
using (private.can_module_admin('access'));

commit;
