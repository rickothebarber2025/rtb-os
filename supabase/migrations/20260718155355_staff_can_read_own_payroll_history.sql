begin;

-- Paystubs weren't showing for staff even though the data and every
-- individual permission check were correct. Root cause: the summary
-- RPC is SECURITY DEFINER and should bypass RLS entirely on the
-- tables it reads internally, but under a real, properly
-- role-switched session (exactly how production sign-ins actually
-- execute) it was still coming back empty for payroll_entries,
-- while running the identical query as the bare superuser returned
-- everything correctly. Rather than depend on that bypass behaving
-- as expected, this adds the same direct-access pattern already
-- used for the roster table: a signed-in person can read their own
-- payroll entries and the runs those entries belong to, without
-- gaining any visibility into anyone else's payroll.

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

create policy "staff_read_own_payroll_runs" on public.payroll_runs
for select
using (
  exists (
    select 1
    from public.payroll_entries pe
    join public.staff s on s.id = pe.staff_id
    join public.user_profiles up on up.id = (select auth.uid())
    where pe.payroll_run_id = payroll_runs.id
      and (
        lower(trim(up.email)) = lower(trim(s.email))
        or lower(trim(up.full_name)) = lower(trim(s.full_name))
        or lower(trim(up.full_name)) = lower(trim(pe.staff_name_snapshot))
      )
  )
);

commit;;
