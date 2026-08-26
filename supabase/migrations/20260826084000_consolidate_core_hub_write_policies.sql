drop policy if exists ann_write on public.hub_announcements;
create policy ann_insert on public.hub_announcements for insert to authenticated with check (private.hub_is_admin());
create policy ann_update on public.hub_announcements for update to authenticated using (private.hub_is_admin()) with check (private.hub_is_admin());
create policy ann_delete on public.hub_announcements for delete to authenticated using (private.hub_is_admin());

drop policy if exists biz_write on public.hub_businesses;
create policy biz_insert on public.hub_businesses for insert to authenticated with check (private.hub_is_admin());
create policy biz_update on public.hub_businesses for update to authenticated using (private.hub_is_admin()) with check (private.hub_is_admin());
create policy biz_delete on public.hub_businesses for delete to authenticated using (private.hub_is_admin());

drop policy if exists news_write on public.hub_newsletters;
create policy news_insert on public.hub_newsletters for insert to authenticated with check (private.hub_is_admin());
create policy news_update on public.hub_newsletters for update to authenticated using (private.hub_is_admin()) with check (private.hub_is_admin());
create policy news_delete on public.hub_newsletters for delete to authenticated using (private.hub_is_admin());

drop policy if exists pol_write on public.hub_policies;
create policy pol_insert on public.hub_policies for insert to authenticated with check (private.hub_is_admin());
create policy pol_update on public.hub_policies for update to authenticated using (private.hub_is_admin()) with check (private.hub_is_admin());
create policy pol_delete on public.hub_policies for delete to authenticated using (private.hub_is_admin());

drop policy if exists prof_admin_all on public.hub_staff_profiles;
drop policy if exists prof_self_update on public.hub_staff_profiles;
create policy prof_admin_insert on public.hub_staff_profiles for insert to authenticated with check (private.hub_is_admin());
create policy prof_update on public.hub_staff_profiles for update to authenticated using (private.hub_is_admin() or auth_user_id = (select auth.uid())) with check (private.hub_is_admin() or auth_user_id = (select auth.uid()));
create policy prof_admin_delete on public.hub_staff_profiles for delete to authenticated using (private.hub_is_admin());
