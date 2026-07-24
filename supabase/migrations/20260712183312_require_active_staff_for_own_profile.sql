create or replace function public.hub_my_profile_id()
returns uuid
language sql
security definer
stable
set search_path = public, auth
as $$
  select id
  from public.hub_staff_profiles
  where is_active
    and (
      auth_user_id = auth.uid()
      or lower(email) = lower(auth.jwt() ->> 'email')
    )
  limit 1;
$$;

revoke all on function public.hub_my_profile_id() from public;;
