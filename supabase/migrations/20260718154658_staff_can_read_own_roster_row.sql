begin;

-- Permanent fix: staff with the standard staff_portal permission
-- template have roster:'none' (correctly -- they shouldn't see the
-- whole team roster). But the only SELECT policy on public.staff
-- required roster:'view' to read ANY row at all, which silently
-- blocked every regular staff member from reading even their OWN
-- row. The app-level matching logic (findStaffProfile) was correct
-- the whole time; it was being handed an empty list before it ever
-- got a chance to run.
--
-- This adds a narrow, separate policy: a signed-in user may read
-- their own staff row (matched by email or name against their own
-- user_profiles record), without granting visibility into anyone
-- else's roster row. Regular staff still cannot browse the roster.

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

commit;;
