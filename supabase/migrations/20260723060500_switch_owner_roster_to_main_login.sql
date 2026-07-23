-- Switched the owner's roster entry to his main admin login
-- (rickothebarber@gmail.com) instead of the secondary rtblounge1@
-- gmail.com login originally requested. No functional difference:
-- rickothebarber@gmail.com already has an automatic hardcoded admin
-- bypass for every module including staff_hub (see
-- private.module_permission), so it resolves through
-- get_my_staff_portal_summary() exactly the same way. This just
-- means checking his own Staff Hub stats doesn't require switching
-- accounts away from his primary daily login.
update public.staff
set email = 'rickothebarber@gmail.com'
where full_name = 'Ricko'
  and email = 'rtblounge1@gmail.com';
