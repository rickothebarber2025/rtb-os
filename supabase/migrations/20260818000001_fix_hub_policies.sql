begin;

-- This migration fixes the hub policy consolidation by properly creating policies
-- instead of trying to ALTER non-existent ones.

-- Drop existing policies if they exist before creating new ones
drop policy if exists hub_admin_all on public.ai_business_consultant_reports;
drop policy if exists hub_admin_select on public.ai_feedback_analysis;
drop policy if exists hub_admin_select on public.app_settings;
drop policy if exists hub_admin_all on public.booth_rent;
drop policy if exists hub_admin_all on public.business_improvement_projects;
drop policy if exists hub_admin_all on public.business_improvement_tasks;
drop policy if exists hub_admin_all on public.business_intelligence_sources;
drop policy if exists hub_admin_select on public.business_units;
drop policy if exists hub_admin_select on public.feedback_ai_jobs;
drop policy if exists hub_admin_select on public.feedback_requests;
drop policy if exists hub_admin_select on public.feedback_responses;
drop policy if exists hub_admin_select on public.payroll_entries;
drop policy if exists hub_admin_select on public.payroll_runs;
drop policy if exists hub_admin_select on public.performance_history;
drop policy if exists hub_admin_select on public.staff;

-- Now create or replace the policies with the correct hub functions
create policy hub_admin_all on public.ai_business_consultant_reports
  for all
  using (private.hub_is_admin())
  with check (private.hub_is_admin());

create policy hub_admin_select on public.ai_feedback_analysis
  for select
  using (private.hub_is_admin());

create policy hub_admin_select on public.app_settings
  for select
  using (private.hub_is_admin());

create policy hub_admin_all on public.booth_rent
  for all
  using (private.hub_is_admin())
  with check (private.hub_is_admin());

create policy hub_admin_all on public.business_improvement_projects
  for all
  using (private.hub_is_admin())
  with check (private.hub_is_admin());

create policy hub_admin_all on public.business_improvement_tasks
  for all
  using (private.hub_is_admin())
  with check (private.hub_is_admin());

create policy hub_admin_all on public.business_intelligence_sources
  for all
  using (private.hub_is_admin())
  with check (private.hub_is_admin());

create policy hub_admin_select on public.business_units
  for select
  using (private.hub_is_admin());

create policy hub_admin_select on public.feedback_ai_jobs
  for select
  using (private.hub_is_admin());

create policy hub_admin_select on public.feedback_requests
  for select
  using (private.hub_is_admin());

create policy hub_admin_select on public.feedback_responses
  for select
  using (private.hub_is_admin());

create policy hub_admin_select on public.payroll_entries
  for select
  using (private.hub_is_admin());

create policy hub_admin_select on public.payroll_runs
  for select
  using (private.hub_is_admin());

create policy hub_admin_select on public.performance_history
  for select
  using (private.hub_is_admin());

create policy hub_admin_select on public.staff
  for select
  using (private.hub_is_admin());

commit;
