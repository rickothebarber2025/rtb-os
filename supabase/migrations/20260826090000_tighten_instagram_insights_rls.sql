drop policy if exists instagram_insights_admin_all on public.instagram_insights;
drop policy if exists instagram_insights_manager_read on public.instagram_insights;

create policy instagram_insights_read on public.instagram_insights
for select to authenticated
using (private.hub_is_admin() or (private.can_module_view('operations') and private.can_access_business_unit(business_unit_id)));

create policy instagram_insights_insert on public.instagram_insights
for insert to authenticated
with check (private.hub_is_admin());

create policy instagram_insights_update on public.instagram_insights
for update to authenticated
using (private.hub_is_admin())
with check (private.hub_is_admin());

create policy instagram_insights_delete on public.instagram_insights
for delete to authenticated
using (private.hub_is_admin());
