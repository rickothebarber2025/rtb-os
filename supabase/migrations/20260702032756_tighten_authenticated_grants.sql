begin;

-- Align table/view privileges with actual frontend write paths. RLS still
-- enforces row-level business/module access; these grants remove unnecessary
-- direct DML privileges from read-only objects.

revoke all on public.feedback_responses from authenticated;
revoke all on public.ai_feedback_analysis from authenticated;
revoke all on public.feedback_requests from authenticated;
revoke all on public.ai_business_consultant_reports from authenticated;
revoke all on public.customer_feedback_enriched from authenticated;
revoke all on public.customer_feedback_summary from authenticated;
revoke all on public.feedback_recurring_issues from authenticated;

grant select on public.feedback_requests to authenticated;
grant select on public.feedback_responses to authenticated;
grant select on public.ai_feedback_analysis to authenticated;
grant select on public.ai_business_consultant_reports to authenticated;
grant select on public.customer_feedback_enriched to authenticated;
grant select on public.customer_feedback_summary to authenticated;
grant select on public.feedback_recurring_issues to authenticated;

-- The AI Consultant page allows direct source/project/task edits through the
-- authenticated client, so keep DML here and let hardened RLS decide scope.
revoke all on public.business_intelligence_sources from authenticated;
revoke all on public.business_improvement_projects from authenticated;
revoke all on public.business_improvement_tasks from authenticated;

grant select, insert, update, delete on public.business_intelligence_sources to authenticated;
grant select, insert, update, delete on public.business_improvement_projects to authenticated;
grant select, insert, update, delete on public.business_improvement_tasks to authenticated;

-- Google Sheets payroll sync uses service_role. Authenticated users only need
-- to report on imported records unless a future UI explicitly edits them.
revoke all on public.payroll_records from authenticated;
grant select on public.payroll_records to authenticated;

commit;
