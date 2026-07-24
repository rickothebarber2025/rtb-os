begin;

-- Same class of gap as payroll_entries/payroll_runs and staff:
-- performance_history required the 'performance' module permission
-- to read any row, which regular staff intentionally don't have,
-- blocking them from seeing their own performance summary (rank,
-- net sales, weeks recorded) even though the underlying RPC logic
-- was otherwise working correctly.

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

commit;;
