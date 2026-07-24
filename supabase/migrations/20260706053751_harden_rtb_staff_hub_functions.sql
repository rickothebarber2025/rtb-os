alter function public.hub_link_profile() set search_path = public, auth;
alter function public.hub_is_admin() set search_path = public, auth;
alter function public.hub_my_profile_id() set search_path = public, auth;

revoke execute on function public.hub_link_profile() from anon;
revoke execute on function public.hub_is_admin() from anon;
revoke execute on function public.hub_my_profile_id() from anon;;
