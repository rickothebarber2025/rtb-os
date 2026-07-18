begin;

-- Paystubs and performance stats weren't showing on the Staff Hub for
-- any regular staff member, even after they were correctly linked and
-- matched. Root cause: the same class of gap already found on
-- public.staff -- payroll_entries, payroll_runs, and
-- performance_history all required their respective module
-- permission ('payroll', 'performance') to be 'view' before ANY row
-- could be read, including a person's own. Regular staff correctly
-- have those permissions set to 'none' (they shouldn't see everyone
-- else's payroll or performance), which also silently blocked their
-- own data.
--
-- The get_my_staff_portal_summary() RPC is SECURITY DEFINER and
-- should bypass RLS entirely on the tables it reads. Verified via a
-- properly role-switched session simulation (matching how real
-- production sign-ins actually execute, not a bare superuser query)
-- that it was NOT bypassing RLS as expected in this environment for
-- the nested payroll/performance queries -- the identical query
-- returned complete, correct data as a bare superuser, and empty
-- results under a real authenticated session. Rather than depend on
-- that bypass behavior, this adds the same direct-access policies
-- already used for public.staff: a signed-in person can read their
-- own payroll entries, the payroll runs those entries belong to, and
-- their own performance history -- nothing belonging to anyone else.

create policy "staff_read_own_payroll_entries" on public.payroll_entries
for select
using (
  exists (
    select 1
    from public.staff s
    join public.user_profiles up on up.id = (select auth.uid())
    where s.id = payroll_entries.staff_id
      and (
        lower(trim(up.email)) = lower(trim(s.email))
        or lower(trim(up.full_name)) = lower(trim(s.full_name))
      )
  )
  or exists (
    select 1
    from public.user_profiles up
    where up.id = (select auth.uid())
      and lower(trim(up.full_name)) = lower(trim(payroll_entries.staff_name_snapshot))
  )
);

create or replace function private.staff_owns_payroll_run(p_run_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1
    from public.payroll_entries pe
    join public.staff s on s.id = pe.staff_id
    join public.user_profiles up on up.id = (select auth.uid())
    where pe.payroll_run_id = p_run_id
      and (
        lower(trim(up.email)) = lower(trim(s.email))
        or lower(trim(up.full_name)) = lower(trim(s.full_name))
        or lower(trim(up.full_name)) = lower(trim(pe.staff_name_snapshot))
      )
  );
$fn$;

revoke all on function private.staff_owns_payroll_run(uuid) from public, anon;
grant execute on function private.staff_owns_payroll_run(uuid) to authenticated;

-- Note: an initial version of this policy queried payroll_entries
-- directly instead of going through the function above, which caused
-- "infinite recursion detected in policy for relation payroll_entries"
-- since the RPC joins payroll_entries to payroll_runs in the same
-- statement. Routing the cross-table check through a SECURITY
-- DEFINER function (the same pattern already used elsewhere in this
-- codebase, e.g. private.can_access_business_unit) avoids the cycle.
create policy "staff_read_own_payroll_runs" on public.payroll_runs
for select
using (private.staff_owns_payroll_run(id));

create policy "staff_read_own_performance_history" on public.performance_history
for select
using (
  exists (
    select 1
    from public.staff s
    join public.user_profiles up on up.id = (select auth.uid())
    where s.id = performance_history.staff_id
      and (
        lower(trim(up.email)) = lower(trim(s.email))
        or lower(trim(up.full_name)) = lower(trim(s.full_name))
      )
  )
);

commit;
