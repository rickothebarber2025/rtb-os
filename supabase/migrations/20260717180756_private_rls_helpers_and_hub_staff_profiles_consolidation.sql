begin;

create or replace function private.hub_is_admin()
returns boolean
language sql
stable security definer
set search_path to 'public','auth'
as $fn$
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
$fn$;

create or replace function private.hub_my_profile_id()
returns uuid
language sql
stable security definer
set search_path to 'public','auth'
as $fn$
  select id
  from public.hub_staff_profiles
  where (
    auth_user_id = auth.uid()
    or (
      auth.jwt() ->> 'email' is not null
      and lower(email) = lower(auth.jwt() ->> 'email')
    )
  )
  order by is_active desc, created_at desc
  limit 1;
$fn$;

create or replace function private.hub_my_business_id()
returns uuid
language sql
stable security definer
set search_path to 'public','auth'
as $fn$
  select business_id
  from public.hub_staff_profiles
  where id = private.hub_my_profile_id()
  limit 1;
$fn$;

revoke all on function private.hub_is_admin() from public, anon, authenticated;
revoke all on function private.hub_my_profile_id() from public, anon, authenticated;
revoke all on function private.hub_my_business_id() from public, anon, authenticated;
grant execute on function private.hub_is_admin() to authenticated;
grant execute on function private.hub_my_profile_id() to authenticated;
grant execute on function private.hub_my_business_id() to authenticated;

ALTER POLICY "hub_admin_all" ON public.ai_business_consultant_reports USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.ai_feedback_analysis USING (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.app_settings USING (private.hub_is_admin());
ALTER POLICY "hub_admin_all" ON public.booth_rent USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "hub_admin_all" ON public.business_improvement_projects USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "hub_admin_all" ON public.business_improvement_tasks USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "hub_admin_all" ON public.business_intelligence_sources USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.business_units USING (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.feedback_ai_jobs USING (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.feedback_requests USING (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.feedback_responses USING (private.hub_is_admin());
ALTER POLICY "annread_own" ON public.hub_announcement_reads USING ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin()) WITH CHECK ((staff_id = private.hub_my_profile_id()));
ALTER POLICY "ann_write" ON public.hub_announcements USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "avail_own" ON public.hub_availability USING ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin()) WITH CHECK ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());
ALTER POLICY "biz_write" ON public.hub_businesses USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "content_delete" ON public.hub_content_submissions USING (private.hub_is_admin() OR (staff_id = private.hub_my_profile_id()));
ALTER POLICY "content_insert" ON public.hub_content_submissions WITH CHECK ((staff_id = private.hub_my_profile_id()));
ALTER POLICY "content_read" ON public.hub_content_submissions USING (private.hub_is_admin() OR (staff_id = private.hub_my_profile_id()) OR ((status = 'approved'::text) AND hub_staff_in_my_business(staff_id)));
ALTER POLICY "content_update" ON public.hub_content_submissions USING (private.hub_is_admin() OR ((staff_id = private.hub_my_profile_id()) AND (status = 'pending'::text))) WITH CHECK (private.hub_is_admin() OR (staff_id = private.hub_my_profile_id()));
ALTER POLICY "inc_admin" ON public.hub_income_records WITH CHECK (private.hub_is_admin());
ALTER POLICY "inc_admin_d" ON public.hub_income_records USING (private.hub_is_admin());
ALTER POLICY "inc_admin_u" ON public.hub_income_records USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "inc_read" ON public.hub_income_records USING ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());
ALTER POLICY "news_read" ON public.hub_newsletters USING (private.hub_is_admin() OR (published AND hub_can_read_business(business_id)));
ALTER POLICY "news_write" ON public.hub_newsletters USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "perf_admin" ON public.hub_performance_records WITH CHECK (private.hub_is_admin());
ALTER POLICY "perf_admin_d" ON public.hub_performance_records USING (private.hub_is_admin());
ALTER POLICY "perf_admin_u" ON public.hub_performance_records USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "perf_read" ON public.hub_performance_records USING ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());
ALTER POLICY "pol_write" ON public.hub_policies USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "prof_admin_all" ON public.hub_staff_profiles USING (private.hub_is_admin()) WITH CHECK (private.hub_is_admin());
ALTER POLICY "task_admin_d" ON public.hub_tasks USING (private.hub_is_admin());
ALTER POLICY "task_admin_i" ON public.hub_tasks WITH CHECK (private.hub_is_admin());
ALTER POLICY "task_read" ON public.hub_tasks USING ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());
ALTER POLICY "task_staff_update" ON public.hub_tasks USING ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin()) WITH CHECK ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());
ALTER POLICY "to_delete" ON public.hub_time_off_requests USING (private.hub_is_admin() OR ((staff_id = private.hub_my_profile_id()) AND (status = 'pending'::text)));
ALTER POLICY "to_insert" ON public.hub_time_off_requests WITH CHECK ((staff_id = private.hub_my_profile_id()));
ALTER POLICY "to_read" ON public.hub_time_off_requests USING ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());
ALTER POLICY "to_update" ON public.hub_time_off_requests USING (private.hub_is_admin() OR ((staff_id = private.hub_my_profile_id()) AND (status = 'pending'::text))) WITH CHECK (private.hub_is_admin() OR (staff_id = private.hub_my_profile_id()));
ALTER POLICY "hub_admin_select" ON public.payroll_entries USING (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.payroll_runs USING (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.performance_history USING (private.hub_is_admin());
ALTER POLICY "hub_admin_select" ON public.staff USING (private.hub_is_admin());

drop policy if exists hub_staff_profiles_select_by_business_unit_fallback on public.hub_staff_profiles;

alter policy "prof_read" on public.hub_staff_profiles
  using (
    (id = private.hub_my_profile_id())
    or private.hub_is_admin()
    or (is_active and business_id = private.hub_my_business_id())
    or (
      is_active
      and business_id = (
        select up.business_unit_id
        from public.user_profiles up
        where up.id = (select auth.uid())
      )
    )
  );

drop function if exists public.hub_is_admin();
drop function if exists public.hub_my_profile_id();
drop function if exists public.hub_my_business_id();

commit;;
