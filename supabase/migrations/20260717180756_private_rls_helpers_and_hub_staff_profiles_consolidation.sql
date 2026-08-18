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

-- These policies are created by subsequent migrations to ensure idempotency.
-- Using DROP IF EXISTS + CREATE POLICY pattern instead of ALTER to handle
-- the case where policies may not exist on initial migration run.
drop policy if exists "hub_admin_all" on public.ai_business_consultant_reports;
create policy "hub_admin_all" on public.ai_business_consultant_reports for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.ai_feedback_analysis;
create policy "hub_admin_select" on public.ai_feedback_analysis for select using (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.app_settings;
create policy "hub_admin_select" on public.app_settings for select using (private.hub_is_admin());

drop policy if exists "hub_admin_all" on public.booth_rent;
create policy "hub_admin_all" on public.booth_rent for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "hub_admin_all" on public.business_improvement_projects;
create policy "hub_admin_all" on public.business_improvement_projects for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "hub_admin_all" on public.business_improvement_tasks;
create policy "hub_admin_all" on public.business_improvement_tasks for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "hub_admin_all" on public.business_intelligence_sources;
create policy "hub_admin_all" on public.business_intelligence_sources for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.business_units;
create policy "hub_admin_select" on public.business_units for select using (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.feedback_ai_jobs;
create policy "hub_admin_select" on public.feedback_ai_jobs for select using (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.feedback_requests;
create policy "hub_admin_select" on public.feedback_requests for select using (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.feedback_responses;
create policy "hub_admin_select" on public.feedback_responses for select using (private.hub_is_admin());

drop policy if exists "annread_own" on public.hub_announcement_reads;
create policy "annread_own" on public.hub_announcement_reads for all using ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin()) with check ((staff_id = private.hub_my_profile_id()));

drop policy if exists "ann_write" on public.hub_announcements;
create policy "ann_write" on public.hub_announcements for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "avail_own" on public.hub_availability;
create policy "avail_own" on public.hub_availability for all using ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin()) with check ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());

drop policy if exists "biz_write" on public.hub_businesses;
create policy "biz_write" on public.hub_businesses for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "content_delete" on public.hub_content_submissions;
create policy "content_delete" on public.hub_content_submissions for delete using (private.hub_is_admin() OR (staff_id = private.hub_my_profile_id()));

drop policy if exists "content_insert" on public.hub_content_submissions;
create policy "content_insert" on public.hub_content_submissions for insert with check ((staff_id = private.hub_my_profile_id()));

drop policy if exists "content_read" on public.hub_content_submissions;
create policy "content_read" on public.hub_content_submissions for select using (private.hub_is_admin() OR (staff_id = private.hub_my_profile_id()) OR ((status = 'approved'::text) AND hub_staff_in_my_business(staff_id)));

drop policy if exists "content_update" on public.hub_content_submissions;
create policy "content_update" on public.hub_content_submissions for update using (private.hub_is_admin() OR ((staff_id = private.hub_my_profile_id()) AND (status = 'pending'::text))) with check (private.hub_is_admin() OR (staff_id = private.hub_my_profile_id()));

drop policy if exists "inc_admin" on public.hub_income_records;
create policy "inc_admin" on public.hub_income_records for insert with check (private.hub_is_admin());

drop policy if exists "inc_admin_d" on public.hub_income_records;
create policy "inc_admin_d" on public.hub_income_records for delete using (private.hub_is_admin());

drop policy if exists "inc_admin_u" on public.hub_income_records;
create policy "inc_admin_u" on public.hub_income_records for update using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "inc_read" on public.hub_income_records;
create policy "inc_read" on public.hub_income_records for select using ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());

drop policy if exists "news_read" on public.hub_newsletters;
create policy "news_read" on public.hub_newsletters for select using (private.hub_is_admin() OR (published AND hub_can_read_business(business_id)));

drop policy if exists "news_write" on public.hub_newsletters;
create policy "news_write" on public.hub_newsletters for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "perf_admin" on public.hub_performance_records;
create policy "perf_admin" on public.hub_performance_records for insert with check (private.hub_is_admin());

drop policy if exists "perf_admin_d" on public.hub_performance_records;
create policy "perf_admin_d" on public.hub_performance_records for delete using (private.hub_is_admin());

drop policy if exists "perf_admin_u" on public.hub_performance_records;
create policy "perf_admin_u" on public.hub_performance_records for update using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "perf_read" on public.hub_performance_records;
create policy "perf_read" on public.hub_performance_records for select using ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());

drop policy if exists "pol_write" on public.hub_policies;
create policy "pol_write" on public.hub_policies for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "prof_admin_all" on public.hub_staff_profiles;
create policy "prof_admin_all" on public.hub_staff_profiles for all using (private.hub_is_admin()) with check (private.hub_is_admin());

drop policy if exists "task_admin_d" on public.hub_tasks;
create policy "task_admin_d" on public.hub_tasks for delete using (private.hub_is_admin());

drop policy if exists "task_admin_i" on public.hub_tasks;
create policy "task_admin_i" on public.hub_tasks for insert with check (private.hub_is_admin());

drop policy if exists "task_read" on public.hub_tasks;
create policy "task_read" on public.hub_tasks for select using ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());

drop policy if exists "task_staff_update" on public.hub_tasks;
create policy "task_staff_update" on public.hub_tasks for update using ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin()) with check ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());

drop policy if exists "to_delete" on public.hub_time_off_requests;
create policy "to_delete" on public.hub_time_off_requests for delete using (private.hub_is_admin() OR ((staff_id = private.hub_my_profile_id()) AND (status = 'pending'::text)));

drop policy if exists "to_insert" on public.hub_time_off_requests;
create policy "to_insert" on public.hub_time_off_requests for insert with check ((staff_id = private.hub_my_profile_id()));

drop policy if exists "to_read" on public.hub_time_off_requests;
create policy "to_read" on public.hub_time_off_requests for select using ((staff_id = private.hub_my_profile_id()) OR private.hub_is_admin());

drop policy if exists "to_update" on public.hub_time_off_requests;
create policy "to_update" on public.hub_time_off_requests for update using (private.hub_is_admin() OR ((staff_id = private.hub_my_profile_id()) AND (status = 'pending'::text))) with check (private.hub_is_admin() OR (staff_id = private.hub_my_profile_id()));

drop policy if exists "hub_admin_select" on public.payroll_entries;
create policy "hub_admin_select" on public.payroll_entries for select using (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.payroll_runs;
create policy "hub_admin_select" on public.payroll_runs for select using (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.performance_history;
create policy "hub_admin_select" on public.performance_history for select using (private.hub_is_admin());

drop policy if exists "hub_admin_select" on public.staff;
create policy "hub_admin_select" on public.staff for select using (private.hub_is_admin());

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
-- Historical duplicate of the following 20260717180845 consolidation migration.
-- Production already applied this migration family; keeping this version as a
-- marker prevents Supabase Preview from replaying the same policy rewrite twice.
select 1;
