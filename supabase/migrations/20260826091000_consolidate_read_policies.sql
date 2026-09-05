drop policy if exists ai_feedback_analysis_select_by_customer_intelligence_access on public.ai_feedback_analysis;
drop policy if exists hub_admin_select on public.ai_feedback_analysis;
create policy ai_feedback_analysis_read on public.ai_feedback_analysis for select to authenticated using (
  private.hub_is_admin() or exists (
    select 1 from public.feedback_responses fres
    join public.feedback_requests fr on fr.id = fres.feedback_request_id
    where fres.id = ai_feedback_analysis.feedback_response_id
      and private.can_access_business_any_module(fr.business_id, array['performance','operations','settings'], 'view')
  )
);

drop policy if exists app_settings_read_by_key_scope on public.app_settings;
drop policy if exists hub_admin_select on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (private.hub_is_admin() or private.can_read_app_setting(key, value));

drop policy if exists business_units_read_by_assigned_module on public.business_units;
drop policy if exists hub_admin_select on public.business_units;
create policy business_units_read on public.business_units for select to authenticated using (private.hub_is_admin() or (private.has_any_module_view() and private.can_access_business_unit(id)));

drop policy if exists feedback_requests_select_by_customer_intelligence_access on public.feedback_requests;
drop policy if exists hub_admin_select on public.feedback_requests;
create policy feedback_requests_read on public.feedback_requests for select to authenticated using (private.hub_is_admin() or private.can_access_business_any_module(business_id, array['performance','operations','settings'], 'view'));

drop policy if exists feedback_responses_select_by_customer_intelligence_access on public.feedback_responses;
drop policy if exists hub_admin_select on public.feedback_responses;
create policy feedback_responses_read on public.feedback_responses for select to authenticated using (
  private.hub_is_admin() or exists (
    select 1 from public.feedback_requests fr
    where fr.id = feedback_responses.feedback_request_id
      and private.can_access_business_any_module(fr.business_id, array['performance','operations','settings'], 'view')
  )
);

drop policy if exists hub_admin_select on public.payroll_entries;
drop policy if exists payroll_entries_read on public.payroll_entries;
drop policy if exists staff_read_own_payroll_entries on public.payroll_entries;
create policy payroll_entries_read on public.payroll_entries for select to authenticated using (
  private.hub_is_admin()
  or (private.can_module_view('payroll') and exists (
    select 1 from public.payroll_runs pr where pr.id = payroll_entries.payroll_run_id and private.can_access_business_unit(pr.business_unit_id)
  ))
  or (private.can_read_own_financials() and (
    exists (
      select 1 from public.staff s join public.user_profiles up on up.id = (select auth.uid())
      where s.id = payroll_entries.staff_id and (lower(trim(up.email)) = lower(trim(s.email)) or lower(trim(up.full_name)) = lower(trim(s.full_name)))
    )
    or exists (
      select 1 from public.user_profiles up where up.id = (select auth.uid()) and lower(trim(up.full_name)) = lower(trim(payroll_entries.staff_name_snapshot))
    )
  ))
);

drop policy if exists hub_admin_select on public.payroll_runs;
drop policy if exists payroll_runs_read on public.payroll_runs;
drop policy if exists staff_read_own_payroll_runs on public.payroll_runs;
create policy payroll_runs_read on public.payroll_runs for select to authenticated using (
  private.hub_is_admin() or (private.can_module_view('payroll') and private.can_access_business_unit(business_unit_id)) or (private.can_read_own_financials() and private.staff_owns_payroll_run(id))
);

drop policy if exists hub_admin_select on public.performance_history;
drop policy if exists performance_history_read on public.performance_history;
drop policy if exists staff_read_own_performance_history on public.performance_history;
create policy performance_history_read on public.performance_history for select to authenticated using (
  private.hub_is_admin()
  or (private.can_module_view('performance') and private.can_access_business_unit(business_unit_id))
  or (private.can_read_own_financials() and exists (
    select 1 from public.staff s join public.user_profiles up on up.id = (select auth.uid())
    where s.id = performance_history.staff_id and (lower(trim(up.email)) = lower(trim(s.email)) or lower(trim(up.full_name)) = lower(trim(s.full_name)))
  ))
);

drop policy if exists hub_admin_select on public.staff;
drop policy if exists staff_read_by_roster on public.staff;
drop policy if exists staff_read_own_row on public.staff;
create policy staff_read on public.staff for select to authenticated using (
  private.hub_is_admin()
  or (private.can_module_view('roster') and private.can_access_business_unit(business_unit_id))
  or exists (
    select 1 from public.user_profiles up where up.id = (select auth.uid()) and (lower(trim(up.email)) = lower(trim(staff.email)) or lower(trim(up.full_name)) = lower(trim(staff.full_name)))
  )
);
