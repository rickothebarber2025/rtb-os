-- Staff Hub RLS policies call these helper functions while evaluating
-- authenticated user access. They must be executable by authenticated,
-- but the auth trigger helper should stay restricted to service roles.
grant execute on function public.hub_is_admin() to authenticated;
grant execute on function public.hub_my_profile_id() to authenticated;
grant execute on function public.hub_my_business_id() to authenticated;
grant execute on function public.hub_can_read_business(uuid) to authenticated;
grant execute on function public.hub_staff_in_my_business(uuid) to authenticated;

revoke execute on function public.hub_is_admin() from anon;
