-- RTB Talent Pipeline: separate earning visibility from permanent brand endorsement.
create table if not exists public.talent_candidates (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  specialty text,
  stage text not null default 'applicant' check (stage in ('applicant','interview','audition','new_talent','probation','official','exited')),
  hiring_reason text not null default 'planned_growth' check (hiring_reason in ('planned_growth','replacement','coverage_shortage','urgent_survival')),
  source text,
  start_date date,
  stage_started_at timestamptz not null default now(),
  public_booking_enabled boolean not null default false,
  walk_ins_enabled boolean not null default false,
  social_visibility_enabled boolean not null default false,
  permanent_brand_endorsement boolean not null default false,
  notes text,
  exit_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.talent_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.talent_candidates(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  review_day integer not null check (review_day in (7,14,30,60,90)),
  review_date date not null default current_date,
  attendance numeric(5,2) not null default 0 check (attendance between 0 and 100),
  reliability numeric(5,2) not null default 0 check (reliability between 0 and 100),
  service_quality numeric(5,2) not null default 0 check (service_quality between 0 and 100),
  client_experience numeric(5,2) not null default 0 check (client_experience between 0 and 100),
  rebooking_retention numeric(5,2) not null default 0 check (rebooking_retention between 0 and 100),
  policy_compliance numeric(5,2) not null default 0 check (policy_compliance between 0 and 100),
  professionalism numeric(5,2) not null default 0 check (professionalism between 0 and 100),
  content_participation numeric(5,2) not null default 0 check (content_participation between 0 and 100),
  opportunities_received integer not null default 0,
  walk_ins_assigned integer not null default 0,
  social_features integer not null default 0,
  qualified_leads integer not null default 0,
  bookings_from_opportunities integer not null default 0,
  revenue numeric(12,2) not null default 0,
  average_ticket numeric(12,2) not null default 0,
  critical_failure boolean not null default false,
  critical_failure_reason text,
  manager_notes text,
  recommendation text check (recommendation in ('advance','continue','improvement_plan','exit')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique(candidate_id, review_day)
);

create index if not exists talent_candidates_business_stage_idx on public.talent_candidates(business_unit_id, stage);
create index if not exists talent_reviews_candidate_idx on public.talent_reviews(candidate_id, review_day);

alter table public.talent_candidates enable row level security;
alter table public.talent_reviews enable row level security;

-- Row-level security (RLS) policies
-- NOTE: The original policies allowed full access to any authenticated user. That is too permissive for
-- management/decision data. We replace the permissive "for all to authenticated using (true) with check (true)"
-- policies with a safer default:
--  - SELECT: allow authenticated users to read pipeline summaries so the UI can render.
--  - INSERT/UPDATE/DELETE: restrict to the Supabase service role only (server-side). This prevents client-side
--    authenticated users from modifying management data directly. After review, replace service-role writes with
--    business-scoped manager policies (examples below) appropriate for your RBAC model.
-- To validate in Supabase Preview: run the migration, then test SELECT as an authenticated user and attempt INSERT/UPDATE
-- as a regular client user (should fail) and as a service_role (should succeed). Work with your DB/ops team to adapt.

-- talent_candidates: SELECT allowed for authenticated users
drop policy if exists talent_candidates_select on public.talent_candidates;
create policy talent_candidates_select on public.talent_candidates
  for select
  to authenticated
  using (true);

-- talent_candidates: write operations limited to service role (server-side)
drop policy if exists talent_candidates_write_service on public.talent_candidates;
create policy talent_candidates_write_service on public.talent_candidates
  for insert, update, delete
  to authenticated
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- talent_reviews: SELECT allowed for authenticated users
drop policy if exists talent_reviews_select on public.talent_reviews;
create policy talent_reviews_select on public.talent_reviews
  for select
  to authenticated
  using (true);

-- talent_reviews: write operations limited to service role (server-side)
drop policy if exists talent_reviews_write_service on public.talent_reviews;
create policy talent_reviews_write_service on public.talent_reviews
  for insert, update, delete
  to authenticated
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Guidance: If you want managers to write directly, replace the write policies above with a business-scoped
-- policy such as:
--
-- create policy talent_candidates_write_managers on public.talent_candidates
--   for insert, update, delete
--   to authenticated
--   using (
--     (
--       -- allow server-side service invocations
--       auth.role() = 'service_role'
--     ) OR (
--       -- or allow users who are in the managers table for the same business_unit
--       auth.uid() IS NOT NULL AND EXISTS (
--         SELECT 1 FROM public.business_managers bm
--         WHERE bm.user_id = auth.uid() AND bm.business_unit_id = public.talent_candidates.business_unit_id
--       )
--     )
--   )
--   with check (
--     auth.role() = 'service_role' OR (
--       auth.uid() IS NOT NULL AND EXISTS (
--         SELECT 1 FROM public.business_managers bm
--         WHERE bm.user_id = auth.uid() AND bm.business_unit_id = public.talent_candidates.business_unit_id
--       )
--     )
--   );

create or replace view public.talent_pipeline_summary as
select
  c.*,
  r.review_day as latest_review_day,
  r.review_date as latest_review_date,
  round((
    r.attendance * .20 + r.reliability * .15 + r.service_quality * .15 +
    r.client_experience * .15 + r.rebooking_retention * .10 +
    r.policy_compliance * .10 + r.professionalism * .10 + r.content_participation * .05
  )::numeric, 1) as fit_score,
  case when coalesce(r.qualified_leads,0) > 0
    then round((r.bookings_from_opportunities::numeric / r.qualified_leads::numeric) * 100, 1)
    else null end as opportunity_conversion_rate,
  r.critical_failure,
  r.recommendation
from public.talent_candidates c
left join lateral (
  select tr.* from public.talent_reviews tr
  where tr.candidate_id = c.id
  order by tr.review_day desc limit 1
) r on true;
