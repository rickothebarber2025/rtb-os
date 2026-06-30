begin;

create table if not exists public.feedback_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id text,
  appointment_id text,
  staff_id uuid references public.staff(id) on delete set null,
  business_id uuid not null references public.business_units(id) on delete cascade,
  service_name text not null default 'Appointment',
  customer_name text not null,
  customer_email text,
  customer_phone text,
  survey_token text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'pending',
  send_after timestamptz not null default (now() + interval '2 hours'),
  delivery_channel text not null default 'email',
  sent_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_requests_customer_contact_check
    check (customer_email is not null or customer_phone is not null),
  constraint feedback_requests_customer_name_present
    check (length(btrim(customer_name)) > 0),
  constraint feedback_requests_status_check
    check (status in ('pending', 'sent', 'completed', 'expired', 'failed')),
  constraint feedback_requests_delivery_channel_check
    check (delivery_channel in ('email', 'sms', 'manual'))
);

create unique index if not exists feedback_requests_survey_token_key
on public.feedback_requests(survey_token);

create unique index if not exists feedback_requests_business_appointment_key
on public.feedback_requests(business_id, appointment_id)
where appointment_id is not null;

create index if not exists feedback_requests_business_status_idx
on public.feedback_requests(business_id, status, send_after);

create index if not exists feedback_requests_staff_id_idx
on public.feedback_requests(staff_id);

create table if not exists public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  feedback_request_id uuid not null references public.feedback_requests(id) on delete cascade,
  overall_rating smallint not null,
  welcome_rating smallint not null,
  cleanliness_rating smallint not null,
  professionalism_rating smallint not null,
  atmosphere_rating smallint not null,
  appointment_started_on_time text not null,
  favorite_part text,
  improvement_suggestion text,
  would_return text not null,
  recommend_business smallint not null,
  additional_comments text,
  created_at timestamptz not null default now(),
  constraint feedback_responses_one_per_request unique (feedback_request_id),
  constraint feedback_responses_overall_rating_check check (overall_rating between 1 and 5),
  constraint feedback_responses_welcome_rating_check check (welcome_rating between 1 and 5),
  constraint feedback_responses_cleanliness_rating_check check (cleanliness_rating between 1 and 5),
  constraint feedback_responses_professionalism_rating_check check (professionalism_rating between 1 and 5),
  constraint feedback_responses_atmosphere_rating_check check (atmosphere_rating between 1 and 5),
  constraint feedback_responses_recommend_business_check check (recommend_business between 0 and 10),
  constraint feedback_responses_started_on_time_check
    check (appointment_started_on_time in ('yes', 'within_5_minutes', 'more_than_10_minutes')),
  constraint feedback_responses_would_return_check
    check (would_return in ('definitely', 'probably', 'maybe', 'no'))
);

create index if not exists feedback_responses_created_at_idx
on public.feedback_responses(created_at desc);

create table if not exists public.ai_feedback_analysis (
  id uuid primary key default gen_random_uuid(),
  feedback_response_id uuid not null references public.feedback_responses(id) on delete cascade,
  sentiment text not null,
  summary text not null,
  positive_points jsonb not null default '[]'::jsonb,
  negative_points jsonb not null default '[]'::jsonb,
  main_category text not null,
  priority text not null,
  suggested_action text not null,
  estimated_cost text not null,
  estimated_impact text not null,
  confidence_score numeric(4, 3) not null default 0.7,
  model text,
  raw_result jsonb not null default '{}'::jsonb,
  created_project_id uuid,
  created_at timestamptz not null default now(),
  constraint ai_feedback_analysis_one_per_response unique (feedback_response_id),
  constraint ai_feedback_analysis_sentiment_check
    check (sentiment in ('positive', 'neutral', 'mixed', 'negative')),
  constraint ai_feedback_analysis_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint ai_feedback_analysis_confidence_score_check
    check (confidence_score >= 0 and confidence_score <= 1)
);

create index if not exists ai_feedback_analysis_category_idx
on public.ai_feedback_analysis(main_category, priority);

create table if not exists public.feedback_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  feedback_response_id uuid not null references public.feedback_responses(id) on delete cascade,
  job_type text not null default 'analyze_feedback',
  status text not null default 'queued',
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_ai_jobs_job_type_check check (job_type in ('analyze_feedback')),
  constraint feedback_ai_jobs_status_check check (status in ('queued', 'processing', 'completed', 'failed')),
  constraint feedback_ai_jobs_attempts_check check (attempts >= 0)
);

create unique index if not exists feedback_ai_jobs_open_response_job_key
on public.feedback_ai_jobs(feedback_response_id, job_type)
where status in ('queued', 'processing');

create index if not exists feedback_ai_jobs_status_run_after_idx
on public.feedback_ai_jobs(status, run_after);

create table if not exists public.business_intelligence_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_units(id) on delete cascade,
  source_type text not null,
  title text not null,
  body text not null,
  source_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_intelligence_sources_type_check
    check (source_type in (
      'customer_feedback',
      'google_review',
      'business_audit',
      'uploaded_document',
      'staff_suggestion',
      'meeting_note',
      'financial_report',
      'incident_report',
      'payroll',
      'staff_performance',
      'appointment_trend',
      'booksy_import',
      'square_data',
      'inventory',
      'email_conversation',
      'other'
    )),
  constraint business_intelligence_sources_title_present check (length(btrim(title)) > 0),
  constraint business_intelligence_sources_body_present check (length(btrim(body)) > 0)
);

create index if not exists business_intelligence_sources_business_type_idx
on public.business_intelligence_sources(business_id, source_type, created_at desc);

create table if not exists public.business_improvement_projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_units(id) on delete cascade,
  issue_key text not null,
  title text not null,
  reason text not null,
  source_type text not null default 'customer_feedback',
  source_ref_ids uuid[] not null default '{}'::uuid[],
  status text not null default 'open',
  priority text not null default 'medium',
  estimated_cost text not null default 'Low',
  estimated_revenue_impact text not null default 'Medium',
  recurring_count integer not null default 1,
  confidence_score numeric(4, 3) not null default 0.7,
  owner_staff_id uuid references public.staff(id) on delete set null,
  due_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_improvement_projects_status_check
    check (status in ('open', 'in_progress', 'done', 'ignored')),
  constraint business_improvement_projects_priority_check
    check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint business_improvement_projects_recurring_count_check check (recurring_count >= 1),
  constraint business_improvement_projects_confidence_score_check
    check (confidence_score >= 0 and confidence_score <= 1)
);

create unique index if not exists business_improvement_projects_business_issue_key
on public.business_improvement_projects(business_id, issue_key)
where status <> 'ignored';

create index if not exists business_improvement_projects_business_status_idx
on public.business_improvement_projects(business_id, status, priority);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_feedback_analysis_created_project_id_fkey'
  ) then
    alter table public.ai_feedback_analysis
      add constraint ai_feedback_analysis_created_project_id_fkey
      foreign key (created_project_id)
      references public.business_improvement_projects(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.business_improvement_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.business_improvement_projects(id) on delete cascade,
  title text not null,
  status text not null default 'open',
  owner_staff_id uuid references public.staff(id) on delete set null,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_improvement_tasks_status_check check (status in ('open', 'done')),
  constraint business_improvement_tasks_title_present check (length(btrim(title)) > 0)
);

create index if not exists business_improvement_tasks_project_status_idx
on public.business_improvement_tasks(project_id, status);

create table if not exists public.ai_business_consultant_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_units(id) on delete cascade,
  summary text not null,
  biggest_problems jsonb not null default '[]'::jsonb,
  fix_first text not null,
  highest_roi text not null,
  lowest_cost text not null,
  recurring_problems jsonb not null default '[]'::jsonb,
  delegate_recommendations jsonb not null default '[]'::jsonb,
  model text,
  confidence_score numeric(4, 3) not null default 0.7,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ai_business_consultant_reports_confidence_score_check
    check (confidence_score >= 0 and confidence_score <= 1)
);

create index if not exists ai_business_consultant_reports_business_created_idx
on public.ai_business_consultant_reports(business_id, created_at desc);

alter table public.feedback_requests enable row level security;
alter table public.feedback_responses enable row level security;
alter table public.ai_feedback_analysis enable row level security;
alter table public.feedback_ai_jobs enable row level security;
alter table public.business_intelligence_sources enable row level security;
alter table public.business_improvement_projects enable row level security;
alter table public.business_improvement_tasks enable row level security;
alter table public.ai_business_consultant_reports enable row level security;

drop policy if exists feedback_requests_manage_by_business_access on public.feedback_requests;
create policy feedback_requests_manage_by_business_access
on public.feedback_requests
for all
to authenticated
using (private.can_access_business_unit(business_id))
with check (private.can_access_business_unit(business_id));

drop policy if exists feedback_responses_select_by_request_business_access on public.feedback_responses;
create policy feedback_responses_select_by_request_business_access
on public.feedback_responses
for select
to authenticated
using (
  exists (
    select 1
    from public.feedback_requests fr
    where fr.id = feedback_request_id
      and private.can_access_business_unit(fr.business_id)
  )
);

drop policy if exists ai_feedback_analysis_select_by_response_business_access on public.ai_feedback_analysis;
create policy ai_feedback_analysis_select_by_response_business_access
on public.ai_feedback_analysis
for select
to authenticated
using (
  exists (
    select 1
    from public.feedback_responses fres
    join public.feedback_requests fr on fr.id = fres.feedback_request_id
    where fres.id = feedback_response_id
      and private.can_access_business_unit(fr.business_id)
  )
);

drop policy if exists business_intelligence_sources_manage_by_business_access on public.business_intelligence_sources;
create policy business_intelligence_sources_manage_by_business_access
on public.business_intelligence_sources
for all
to authenticated
using (private.can_access_business_unit(business_id))
with check (private.can_access_business_unit(business_id));

drop policy if exists business_improvement_projects_manage_by_business_access on public.business_improvement_projects;
create policy business_improvement_projects_manage_by_business_access
on public.business_improvement_projects
for all
to authenticated
using (private.can_access_business_unit(business_id))
with check (private.can_access_business_unit(business_id));

drop policy if exists business_improvement_tasks_manage_by_project_business_access on public.business_improvement_tasks;
create policy business_improvement_tasks_manage_by_project_business_access
on public.business_improvement_tasks
for all
to authenticated
using (
  exists (
    select 1
    from public.business_improvement_projects bip
    where bip.id = project_id
      and private.can_access_business_unit(bip.business_id)
  )
)
with check (
  exists (
    select 1
    from public.business_improvement_projects bip
    where bip.id = project_id
      and private.can_access_business_unit(bip.business_id)
  )
);

drop policy if exists ai_business_consultant_reports_manage_by_business_access on public.ai_business_consultant_reports;
create policy ai_business_consultant_reports_manage_by_business_access
on public.ai_business_consultant_reports
for all
to authenticated
using (private.can_access_business_unit(business_id))
with check (private.can_access_business_unit(business_id));

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

grant select, insert, update, delete on public.feedback_requests to authenticated;
grant select on public.feedback_responses to authenticated;
grant select on public.ai_feedback_analysis to authenticated;
grant select, insert, update, delete on public.business_intelligence_sources to authenticated;
grant select, insert, update, delete on public.business_improvement_projects to authenticated;
grant select, insert, update, delete on public.business_improvement_tasks to authenticated;
grant select, insert, update, delete on public.ai_business_consultant_reports to authenticated;
grant select on public.customer_feedback_enriched to authenticated;
grant select on public.customer_feedback_summary to authenticated;
grant select on public.feedback_recurring_issues to authenticated;

grant all on public.feedback_requests to service_role;
grant all on public.feedback_responses to service_role;
grant all on public.ai_feedback_analysis to service_role;
grant all on public.feedback_ai_jobs to service_role;
grant all on public.business_intelligence_sources to service_role;
grant all on public.business_improvement_projects to service_role;
grant all on public.business_improvement_tasks to service_role;
grant all on public.ai_business_consultant_reports to service_role;

commit;
