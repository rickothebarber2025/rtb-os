alter table public.hub_newsletters
  add column if not exists business_id uuid references public.hub_businesses(id);

alter table public.hub_newsletters
  drop constraint if exists hub_newsletters_week_start_key;

create unique index if not exists hub_newsletters_business_week_uidx
on public.hub_newsletters (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), week_start);

create or replace function public.hub_my_business_id()
returns uuid
language sql
security definer
stable
set search_path = public, auth
as $$
  select business_id
  from public.hub_staff_profiles
  where id = public.hub_my_profile_id()
  limit 1;
$$;

create or replace function public.hub_can_read_business(target_business_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select public.hub_is_admin()
    or target_business_id is null
    or target_business_id = public.hub_my_business_id();
$$;

create or replace function public.hub_staff_in_my_business(target_staff_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select public.hub_is_admin()
    or target_staff_id = public.hub_my_profile_id()
    or exists (
      select 1
      from public.hub_staff_profiles p
      where p.id = target_staff_id
        and p.is_active
        and p.business_id = public.hub_my_business_id()
    );
$$;

revoke all on function public.hub_my_business_id() from public;
revoke all on function public.hub_can_read_business(uuid) from public;
revoke all on function public.hub_staff_in_my_business(uuid) from public;
grant execute on function public.hub_my_business_id() to authenticated;
grant execute on function public.hub_can_read_business(uuid) to authenticated;
grant execute on function public.hub_staff_in_my_business(uuid) to authenticated;

drop policy if exists prof_read on public.hub_staff_profiles;
create policy prof_read on public.hub_staff_profiles for select to authenticated
  using (id = public.hub_my_profile_id() or public.hub_is_admin() or (is_active and business_id = public.hub_my_business_id()));

drop policy if exists ann_read on public.hub_announcements;
create policy ann_read on public.hub_announcements for select to authenticated
  using (public.hub_can_read_business(business_id));

drop policy if exists pol_read on public.hub_policies;
create policy pol_read on public.hub_policies for select to authenticated
  using (public.hub_can_read_business(business_id));

drop policy if exists news_read on public.hub_newsletters;
create policy news_read on public.hub_newsletters for select to authenticated
  using (public.hub_is_admin() or (published and public.hub_can_read_business(business_id)));

drop policy if exists content_read on public.hub_content_submissions;
create policy content_read on public.hub_content_submissions for select to authenticated
  using (public.hub_is_admin() or staff_id = public.hub_my_profile_id() or (status = 'approved' and public.hub_staff_in_my_business(staff_id)));;
