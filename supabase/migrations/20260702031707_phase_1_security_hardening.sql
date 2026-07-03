begin;

-- Phase 1 hardening:
-- - app_settings keys that contain business data are no longer readable/writable
--   by any user with any module.
-- - Imported payroll records and customer intelligence tables now require both
--   business access and the relevant module permission.
-- - Feedback/reporting views keep security_invoker behavior and rely on the
--   hardened base-table RLS below.

create or replace function private.can_access_business_module(
  p_business_unit_id uuid,
  p_module text,
  p_minimum text default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_access_business_unit(p_business_unit_id)
    and private.permission_rank(private.module_permission(p_module)) >= private.permission_rank(p_minimum);
$function$;

create or replace function private.can_access_business_any_module(
  p_business_unit_id uuid,
  p_modules text[],
  p_minimum text default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_access_business_unit(p_business_unit_id)
    and exists (
      select 1
      from unnest(coalesce(p_modules, array[]::text[])) as module_name
      where private.permission_rank(private.module_permission(module_name)) >= private.permission_rank(p_minimum)
    );
$function$;

create or replace function private.owner_or_access_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.can_module_admin('access')
    or exists (
      select 1
      from public.user_profiles up
      where up.id = (select auth.uid())
        and lower(up.email) = 'rickothebarber@gmail.com'
    );
$function$;

create or replace function private.global_settings_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.owner_or_access_admin()
    or private.can_module_admin('settings');
$function$;

create or replace function private.business_id_by_name(p_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select bu.id
  from public.business_units bu
  where lower(btrim(bu.name)) = lower(btrim(p_name))
  limit 1;
$function$;

create or replace function private.app_setting_business_id(p_key text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select case p_key
    when 'rtb_master_dashboard' then private.business_id_by_name('RTB Lounge')
    when 'booksy_import_mappings' then private.business_id_by_name('RTB Lounge')
    when 'rtb_beauty_square_appointments' then private.business_id_by_name('RTB Beauty Lounge')
    when 'square_sync_usage' then private.business_id_by_name('RTB Beauty Lounge')
    else null::uuid
  end;
$function$;

create or replace function private.app_setting_is_global_sensitive(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p_key in (
    'appointment_sources',
    'business_profiles',
    'staff_business_metadata',
    'rtb_action_center'
  );
$function$;

create or replace function private.can_read_app_setting(p_key text, p_value jsonb default '{}'::jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when private.app_setting_is_global_sensitive(p_key)
      then private.global_settings_admin()
    when private.app_setting_business_id(p_key) is not null
      then private.can_access_business_module(private.app_setting_business_id(p_key), 'appointments', 'view')
    else private.can_module_view('settings')
  end;
$function$;

create or replace function private.can_write_app_setting(p_key text, p_value jsonb default '{}'::jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when private.app_setting_is_global_sensitive(p_key)
      then private.global_settings_admin()
    when private.app_setting_business_id(p_key) is not null
      then private.can_access_business_module(private.app_setting_business_id(p_key), 'appointments', 'edit')
    else private.can_module_edit('settings')
  end;
$function$;

grant execute on function private.can_access_business_module(uuid, text, text) to authenticated;
grant execute on function private.can_access_business_any_module(uuid, text[], text) to authenticated;
grant execute on function private.owner_or_access_admin() to authenticated;
grant execute on function private.global_settings_admin() to authenticated;
grant execute on function private.business_id_by_name(text) to authenticated;
grant execute on function private.app_setting_business_id(text) to authenticated;
grant execute on function private.app_setting_is_global_sensitive(text) to authenticated;
grant execute on function private.can_read_app_setting(text, jsonb) to authenticated;
grant execute on function private.can_write_app_setting(text, jsonb) to authenticated;

-- Business units are non-sensitive by themselves, but still scoped by assigned
-- business. This keeps security_invoker reporting views from accidentally
-- hiding business labels for users who have performance or operations access.
drop policy if exists business_units_read_by_dashboard_or_roster on public.business_units;
create policy business_units_read_by_assigned_module
on public.business_units
for select
to authenticated
using (
  private.has_any_module_view()
  and private.can_access_business_unit(id)
);

-- app_settings: replace broad any-module policies with key-aware policies.
drop policy if exists app_settings_read_by_any_assigned_module on public.app_settings;
drop policy if exists app_settings_insert_by_related_module on public.app_settings;
drop policy if exists app_settings_update_by_related_module on public.app_settings;
drop policy if exists app_settings_delete_by_settings_admin on public.app_settings;
drop policy if exists app_settings_read_by_key_scope on public.app_settings;
drop policy if exists app_settings_insert_by_key_scope on public.app_settings;
drop policy if exists app_settings_update_by_key_scope on public.app_settings;
drop policy if exists app_settings_delete_by_settings_admin_hardened on public.app_settings;

create policy app_settings_read_by_key_scope
on public.app_settings
for select
to authenticated
using (private.can_read_app_setting(key, value));

create policy app_settings_insert_by_key_scope
on public.app_settings
for insert
to authenticated
with check (private.can_write_app_setting(key, value));

create policy app_settings_update_by_key_scope
on public.app_settings
for update
to authenticated
using (private.can_write_app_setting(key, value))
with check (private.can_write_app_setting(key, value));

create policy app_settings_delete_by_settings_admin_hardened
on public.app_settings
for delete
to authenticated
using (private.global_settings_admin());

-- Imported payroll records: payroll module + assigned business is required.
drop policy if exists payroll_records_select_by_business_access on public.payroll_records;
drop policy if exists payroll_records_admin_insert on public.payroll_records;
drop policy if exists payroll_records_admin_update on public.payroll_records;
drop policy if exists payroll_records_admin_delete on public.payroll_records;
drop policy if exists payroll_records_select_by_payroll_access on public.payroll_records;
drop policy if exists payroll_records_insert_by_payroll_edit on public.payroll_records;
drop policy if exists payroll_records_update_by_payroll_edit on public.payroll_records;
drop policy if exists payroll_records_delete_by_payroll_admin on public.payroll_records;

create policy payroll_records_select_by_payroll_access
on public.payroll_records
for select
to authenticated
using (private.can_access_business_module(business_unit_id, 'payroll', 'view'));

create policy payroll_records_insert_by_payroll_edit
on public.payroll_records
for insert
to authenticated
with check (private.can_access_business_module(business_unit_id, 'payroll', 'edit'));

create policy payroll_records_update_by_payroll_edit
on public.payroll_records
for update
to authenticated
using (private.can_access_business_module(business_unit_id, 'payroll', 'edit'))
with check (private.can_access_business_module(business_unit_id, 'payroll', 'edit'));

create policy payroll_records_delete_by_payroll_admin
on public.payroll_records
for delete
to authenticated
using (private.can_access_business_module(business_unit_id, 'payroll', 'admin'));

-- Customer feedback and intelligence: business access + performance/operations/settings.
drop policy if exists feedback_requests_manage_by_business_access on public.feedback_requests;
drop policy if exists feedback_requests_select_by_customer_intelligence_access on public.feedback_requests;
drop policy if exists feedback_requests_insert_by_customer_intelligence_edit on public.feedback_requests;
drop policy if exists feedback_requests_update_by_customer_intelligence_edit on public.feedback_requests;
drop policy if exists feedback_requests_delete_by_customer_intelligence_admin on public.feedback_requests;

create policy feedback_requests_select_by_customer_intelligence_access
on public.feedback_requests
for select
to authenticated
using (
  private.can_access_business_any_module(business_id, array['performance', 'operations', 'settings'], 'view')
);

create policy feedback_requests_insert_by_customer_intelligence_edit
on public.feedback_requests
for insert
to authenticated
with check (
  private.can_access_business_any_module(business_id, array['performance', 'operations'], 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

create policy feedback_requests_update_by_customer_intelligence_edit
on public.feedback_requests
for update
to authenticated
using (
  private.can_access_business_any_module(business_id, array['performance', 'operations'], 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
)
with check (
  private.can_access_business_any_module(business_id, array['performance', 'operations'], 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

create policy feedback_requests_delete_by_customer_intelligence_admin
on public.feedback_requests
for delete
to authenticated
using (
  private.can_access_business_any_module(business_id, array['performance', 'operations'], 'admin')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

drop policy if exists feedback_responses_select_by_request_business_access on public.feedback_responses;
drop policy if exists feedback_responses_select_by_customer_intelligence_access on public.feedback_responses;
create policy feedback_responses_select_by_customer_intelligence_access
on public.feedback_responses
for select
to authenticated
using (
  exists (
    select 1
    from public.feedback_requests fr
    where fr.id = feedback_request_id
      and private.can_access_business_any_module(fr.business_id, array['performance', 'operations', 'settings'], 'view')
  )
);

drop policy if exists ai_feedback_analysis_select_by_response_business_access on public.ai_feedback_analysis;
drop policy if exists ai_feedback_analysis_select_by_customer_intelligence_access on public.ai_feedback_analysis;
create policy ai_feedback_analysis_select_by_customer_intelligence_access
on public.ai_feedback_analysis
for select
to authenticated
using (
  exists (
    select 1
    from public.feedback_responses fres
    join public.feedback_requests fr on fr.id = fres.feedback_request_id
    where fres.id = feedback_response_id
      and private.can_access_business_any_module(fr.business_id, array['performance', 'operations', 'settings'], 'view')
  )
);

drop policy if exists business_intelligence_sources_manage_by_business_access on public.business_intelligence_sources;
drop policy if exists business_intelligence_sources_select_by_ops_access on public.business_intelligence_sources;
drop policy if exists business_intelligence_sources_insert_by_ops_edit on public.business_intelligence_sources;
drop policy if exists business_intelligence_sources_update_by_ops_edit on public.business_intelligence_sources;
drop policy if exists business_intelligence_sources_delete_by_ops_admin on public.business_intelligence_sources;

create policy business_intelligence_sources_select_by_ops_access
on public.business_intelligence_sources
for select
to authenticated
using (
  private.can_access_business_any_module(business_id, array['operations', 'performance', 'settings'], 'view')
);

create policy business_intelligence_sources_insert_by_ops_edit
on public.business_intelligence_sources
for insert
to authenticated
with check (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

create policy business_intelligence_sources_update_by_ops_edit
on public.business_intelligence_sources
for update
to authenticated
using (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
)
with check (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

create policy business_intelligence_sources_delete_by_ops_admin
on public.business_intelligence_sources
for delete
to authenticated
using (
  private.can_access_business_module(business_id, 'operations', 'admin')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

drop policy if exists business_improvement_projects_manage_by_business_access on public.business_improvement_projects;
drop policy if exists business_improvement_projects_select_by_ops_access on public.business_improvement_projects;
drop policy if exists business_improvement_projects_insert_by_ops_edit on public.business_improvement_projects;
drop policy if exists business_improvement_projects_update_by_ops_edit on public.business_improvement_projects;
drop policy if exists business_improvement_projects_delete_by_ops_admin on public.business_improvement_projects;

create policy business_improvement_projects_select_by_ops_access
on public.business_improvement_projects
for select
to authenticated
using (
  private.can_access_business_any_module(business_id, array['operations', 'performance', 'settings'], 'view')
);

create policy business_improvement_projects_insert_by_ops_edit
on public.business_improvement_projects
for insert
to authenticated
with check (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

create policy business_improvement_projects_update_by_ops_edit
on public.business_improvement_projects
for update
to authenticated
using (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
)
with check (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

create policy business_improvement_projects_delete_by_ops_admin
on public.business_improvement_projects
for delete
to authenticated
using (
  private.can_access_business_module(business_id, 'operations', 'admin')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

drop policy if exists business_improvement_tasks_manage_by_project_business_access on public.business_improvement_tasks;
drop policy if exists business_improvement_tasks_select_by_ops_access on public.business_improvement_tasks;
drop policy if exists business_improvement_tasks_insert_by_ops_edit on public.business_improvement_tasks;
drop policy if exists business_improvement_tasks_update_by_ops_edit on public.business_improvement_tasks;
drop policy if exists business_improvement_tasks_delete_by_ops_admin on public.business_improvement_tasks;

create policy business_improvement_tasks_select_by_ops_access
on public.business_improvement_tasks
for select
to authenticated
using (
  exists (
    select 1
    from public.business_improvement_projects bip
    where bip.id = project_id
      and private.can_access_business_any_module(bip.business_id, array['operations', 'performance', 'settings'], 'view')
  )
);

create policy business_improvement_tasks_insert_by_ops_edit
on public.business_improvement_tasks
for insert
to authenticated
with check (
  exists (
    select 1
    from public.business_improvement_projects bip
    where bip.id = project_id
      and (
        private.can_access_business_module(bip.business_id, 'operations', 'edit')
        or private.can_access_business_module(bip.business_id, 'settings', 'admin')
      )
  )
);

create policy business_improvement_tasks_update_by_ops_edit
on public.business_improvement_tasks
for update
to authenticated
using (
  exists (
    select 1
    from public.business_improvement_projects bip
    where bip.id = project_id
      and (
        private.can_access_business_module(bip.business_id, 'operations', 'edit')
        or private.can_access_business_module(bip.business_id, 'settings', 'admin')
      )
  )
)
with check (
  exists (
    select 1
    from public.business_improvement_projects bip
    where bip.id = project_id
      and (
        private.can_access_business_module(bip.business_id, 'operations', 'edit')
        or private.can_access_business_module(bip.business_id, 'settings', 'admin')
      )
  )
);

create policy business_improvement_tasks_delete_by_ops_admin
on public.business_improvement_tasks
for delete
to authenticated
using (
  exists (
    select 1
    from public.business_improvement_projects bip
    where bip.id = project_id
      and (
        private.can_access_business_module(bip.business_id, 'operations', 'admin')
        or private.can_access_business_module(bip.business_id, 'settings', 'admin')
      )
  )
);

drop policy if exists ai_business_consultant_reports_manage_by_business_access on public.ai_business_consultant_reports;
drop policy if exists ai_business_consultant_reports_select_by_ops_access on public.ai_business_consultant_reports;
drop policy if exists ai_business_consultant_reports_insert_by_ops_edit on public.ai_business_consultant_reports;
drop policy if exists ai_business_consultant_reports_update_by_ops_edit on public.ai_business_consultant_reports;
drop policy if exists ai_business_consultant_reports_delete_by_ops_admin on public.ai_business_consultant_reports;

create policy ai_business_consultant_reports_select_by_ops_access
on public.ai_business_consultant_reports
for select
to authenticated
using (
  private.can_access_business_any_module(business_id, array['operations', 'performance', 'settings'], 'view')
);

create policy ai_business_consultant_reports_insert_by_ops_edit
on public.ai_business_consultant_reports
for insert
to authenticated
with check (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

create policy ai_business_consultant_reports_update_by_ops_edit
on public.ai_business_consultant_reports
for update
to authenticated
using (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
)
with check (
  private.can_access_business_module(business_id, 'operations', 'edit')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

create policy ai_business_consultant_reports_delete_by_ops_admin
on public.ai_business_consultant_reports
for delete
to authenticated
using (
  private.can_access_business_module(business_id, 'operations', 'admin')
  or private.can_access_business_module(business_id, 'settings', 'admin')
);

-- Service role keeps worker access. Authenticated users do not need direct job access.
revoke all on public.feedback_ai_jobs from anon, authenticated;

-- Keep reporting views invoker-secured and explicitly private to signed-in users.
create or replace view public.customer_feedback_enriched
with (security_invoker = true)
as
select
  fr.id as feedback_request_id,
  fr.business_id,
  bu.name as business_name,
  fr.staff_id,
  st.full_name as staff_name,
  fr.customer_id,
  fr.appointment_id,
  fr.service_name,
  fr.customer_name,
  fr.customer_email,
  fr.customer_phone,
  fr.status as request_status,
  fr.sent_at,
  fr.completed_at,
  fr.expires_at,
  fr.created_at as request_created_at,
  fres.id as feedback_response_id,
  fres.overall_rating,
  fres.welcome_rating,
  fres.cleanliness_rating,
  fres.professionalism_rating,
  fres.atmosphere_rating,
  fres.appointment_started_on_time,
  fres.favorite_part,
  fres.improvement_suggestion,
  fres.would_return,
  fres.recommend_business,
  fres.additional_comments,
  fres.created_at as response_created_at,
  afa.id as analysis_id,
  afa.sentiment,
  afa.summary,
  afa.positive_points,
  afa.negative_points,
  afa.main_category,
  afa.priority,
  afa.suggested_action,
  afa.estimated_cost,
  afa.estimated_impact,
  afa.confidence_score,
  afa.created_project_id,
  afa.created_at as analysis_created_at
from public.feedback_requests fr
join public.business_units bu on bu.id = fr.business_id
left join public.staff st on st.id = fr.staff_id
left join public.feedback_responses fres on fres.feedback_request_id = fr.id
left join public.ai_feedback_analysis afa on afa.feedback_response_id = fres.id;

create or replace view public.customer_feedback_summary
with (security_invoker = true)
as
select
  fr.business_id,
  count(fr.id)::integer as total_requests,
  count(fr.sent_at)::integer as sent_requests,
  count(fres.id)::integer as completed_responses,
  round(avg(fres.overall_rating)::numeric, 2) as average_rating,
  round(
    100 * avg(case when fres.overall_rating >= 4 then 1.0 when fres.id is not null then 0.0 end),
    1
  ) as customer_satisfaction,
  round(
    100 * (
      avg(case when fres.recommend_business >= 9 then 1.0 when fres.id is not null then 0.0 end)
      - avg(case when fres.recommend_business <= 6 then 1.0 when fres.id is not null then 0.0 end)
    ),
    1
  ) as nps_score,
  round(
    100 * count(fres.id)::numeric / nullif(count(fr.id), 0),
    1
  ) as response_rate,
  max(fres.created_at) as latest_response_at
from public.feedback_requests fr
left join public.feedback_responses fres on fres.feedback_request_id = fr.id
group by fr.business_id;

create or replace view public.feedback_recurring_issues
with (security_invoker = true)
as
select
  fr.business_id,
  afa.main_category,
  afa.priority,
  count(*)::integer as mention_count,
  max(afa.created_at) as last_seen_at,
  max(afa.suggested_action) as suggested_action,
  max(afa.estimated_cost) as estimated_cost,
  max(afa.estimated_impact) as estimated_impact
from public.ai_feedback_analysis afa
join public.feedback_responses fres on fres.id = afa.feedback_response_id
join public.feedback_requests fr on fr.id = fres.feedback_request_id
group by fr.business_id, afa.main_category, afa.priority;

revoke all on public.feedback_requests from anon;
revoke all on public.feedback_responses from anon;
revoke all on public.ai_feedback_analysis from anon;
revoke all on public.business_intelligence_sources from anon;
revoke all on public.business_improvement_projects from anon;
revoke all on public.business_improvement_tasks from anon;
revoke all on public.ai_business_consultant_reports from anon;
revoke all on public.payroll_records from anon;
revoke all on public.customer_feedback_enriched from anon;
revoke all on public.customer_feedback_summary from anon;
revoke all on public.feedback_recurring_issues from anon;

grant select on public.customer_feedback_enriched to authenticated;
grant select on public.customer_feedback_summary to authenticated;
grant select on public.feedback_recurring_issues to authenticated;

commit;
