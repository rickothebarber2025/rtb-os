-- Staff Hub RLS policies call these helper functions while evaluating
-- authenticated user access. Some production projects use the newer
-- private.* helpers instead, so skip grants for legacy functions that are
-- not present in the target schema.
do $$
begin
  if to_regprocedure('public.hub_is_admin()') is not null then
    execute 'grant execute on function public.hub_is_admin() to authenticated';
    execute 'revoke execute on function public.hub_is_admin() from anon';
  end if;

  if to_regprocedure('public.hub_my_profile_id()') is not null then
    execute 'grant execute on function public.hub_my_profile_id() to authenticated';
  end if;

  if to_regprocedure('public.hub_my_business_id()') is not null then
    execute 'grant execute on function public.hub_my_business_id() to authenticated';
  end if;

  if to_regprocedure('public.hub_can_read_business(uuid)') is not null then
    execute 'grant execute on function public.hub_can_read_business(uuid) to authenticated';
  end if;

  if to_regprocedure('public.hub_staff_in_my_business(uuid)') is not null then
    execute 'grant execute on function public.hub_staff_in_my_business(uuid) to authenticated';
  end if;
end $$;
