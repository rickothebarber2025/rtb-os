create or replace function public.hub_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
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
$function$;

create or replace function public.hub_my_profile_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
  select id
  from public.hub_staff_profiles
  where is_active
    and (
      auth_user_id = auth.uid()
      or lower(email) = lower(auth.jwt() ->> 'email')
    )
  limit 1;
$function$;

create or replace function public.hub_my_business_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
  select business_id
  from public.hub_staff_profiles
  where id = public.hub_my_profile_id()
  limit 1;
$function$;

create or replace function public.hub_staff_in_my_business(target_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $function$
  select public.hub_is_admin()
    or target_staff_id = public.hub_my_profile_id()
    or exists (
      select 1
      from public.hub_staff_profiles p
      where p.id = target_staff_id
        and p.is_active
        and p.business_id = public.hub_my_business_id()
    );
$function$;
;
