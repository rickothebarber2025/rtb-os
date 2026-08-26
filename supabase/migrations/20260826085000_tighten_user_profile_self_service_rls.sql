drop policy if exists user_profiles_delete_own on public.user_profiles;
drop policy if exists user_profiles_insert_own on public.user_profiles;
drop policy if exists user_profiles_select_own on public.user_profiles;
drop policy if exists user_profiles_update_own on public.user_profiles;

drop policy if exists user_profiles_select_by_self_or_access_admin on public.user_profiles;
create policy user_profiles_select_by_self_or_access_admin on public.user_profiles
for select to authenticated
using (id = (select auth.uid()) or private.can_module_admin('access'));

drop policy if exists user_profiles_insert_by_self_pending on public.user_profiles;
create policy user_profiles_insert_by_self_pending on public.user_profiles
for insert to authenticated
with check (id = (select auth.uid()) and role = 'pending' and active is false);

drop policy if exists user_profiles_update_by_access_admin on public.user_profiles;
create policy user_profiles_update_by_access_admin on public.user_profiles
for update to authenticated
using (private.can_module_admin('access'))
with check (private.can_module_admin('access'));

drop policy if exists user_profiles_delete_by_access_admin on public.user_profiles;
create policy user_profiles_delete_by_access_admin on public.user_profiles
for delete to authenticated
using (private.can_module_admin('access'));
