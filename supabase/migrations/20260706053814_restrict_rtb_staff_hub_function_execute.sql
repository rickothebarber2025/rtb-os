revoke all on function public.hub_link_profile() from public;
revoke all on function public.hub_is_admin() from public;
revoke all on function public.hub_my_profile_id() from public;

grant execute on function public.hub_is_admin() to authenticated;
grant execute on function public.hub_my_profile_id() to authenticated;;
