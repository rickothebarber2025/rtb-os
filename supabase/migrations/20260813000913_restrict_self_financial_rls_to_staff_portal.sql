create or replace function private.can_read_own_financials()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.id = (select auth.uid())
      and up.active
      and (
        coalesce(up.permissions->>'role_template', '') = 'staff_portal'
        or lower(coalesce(up.email, '')) = 'rickothebarber@gmail.com'
      )
  );
$$;

revoke all on function private.can_read_own_financials() from public;
grant execute on function private.can_read_own_financials() to authenticated;

drop policy if exists staff_read_own_payroll_entries on public.payroll_entries;
create policy staff_read_own_payroll_entries
on public.payroll_entries
for select
to authenticated
using (
  private.can_read_own_financials()
  and (
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
  )
);

drop policy if exists staff_read_own_payroll_runs on public.payroll_runs;
create policy staff_read_own_payroll_runs
on public.payroll_runs
for select
to authenticated
using (
  private.can_read_own_financials()
  and private.staff_owns_payroll_run(id)
);

drop policy if exists staff_read_own_performance_history on public.performance_history;
create policy staff_read_own_performance_history
on public.performance_history
for select
to authenticated
using (
  private.can_read_own_financials()
  and exists (
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
