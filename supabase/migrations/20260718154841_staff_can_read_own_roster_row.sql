begin;

-- Permanent fix for "No roster profile matched this login" (round 2,
-- the real one). Every fix up to this point corrected the *data*
-- (business assignment, auth links) but the actual blocker was RLS:
-- the only SELECT policy on public.staff required the roster module
-- permission to be 'view'. Every standard staff_portal profile has
-- roster:'none' on purpose (they shouldn't browse the whole team's
-- roster) -- but that same check was also blocking them from reading
-- their OWN row, which the app needs for self-service matching.
--
-- Verified live via a role-simulated query before this fix: a
-- correctly-configured staff profile (Sara) saw zero rows in
-- public.staff. After this fix, the same simulation returns exactly
-- her own row, and only her own row -- confirmed for a second person
-- (Flow) as well.

create policy "staff_read_own_row" on public.staff
for select
using (
  exists (
    select 1
    from public.user_profiles up
    where up.id = (select auth.uid())
      and (
        lower(trim(up.email)) = lower(trim(staff.email))
        or lower(trim(up.full_name)) = lower(trim(staff.full_name))
      )
  )
);

commit;
