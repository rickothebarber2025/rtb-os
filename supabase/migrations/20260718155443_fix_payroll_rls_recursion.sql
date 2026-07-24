begin;

-- The payroll_runs policy just added caused "infinite recursion
-- detected in policy for relation payroll_entries": it queried
-- payroll_entries directly, and the RPC's own join between
-- payroll_entries and payroll_runs in the same statement created a
-- circular dependency between the two tables' policies. Fix: move
-- the cross-table check into a SECURITY DEFINER helper function
-- (the same pattern already used throughout this codebase, e.g.
-- private.can_access_business_unit), so the check runs with RLS
-- bypassed internally instead of triggering another policy
-- evaluation.

drop policy if exists "staff_read_own_payroll_runs" on public.payroll_runs;

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

create policy "staff_read_own_payroll_runs" on public.payroll_runs
for select
using (private.staff_owns_payroll_run(id));

commit;;
