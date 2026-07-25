create or replace function public.hub_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.hub_staff_profiles
    where is_active
      and role = 'admin'
      and (
        auth_user_id = auth.uid()
        or lower(email) = lower(auth.jwt() ->> 'email')
      )
  );
$$;

create or replace function public.hub_my_profile_id()
returns uuid
language sql
security definer
stable
set search_path = public, auth
as $$
  select id
  from public.hub_staff_profiles
  where auth_user_id = auth.uid()
     or lower(email) = lower(auth.jwt() ->> 'email')
  limit 1;
$$;

update public.hub_staff_profiles p
   set auth_user_id = u.id
  from auth.users u
 where p.auth_user_id is null
   and lower(p.email) = lower(u.email);

revoke all on function public.hub_is_admin() from public;
revoke all on function public.hub_my_profile_id() from public;;
