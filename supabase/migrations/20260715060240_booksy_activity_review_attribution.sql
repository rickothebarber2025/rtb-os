begin;

create table if not exists public.staff_source_identities (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete cascade,
  source text not null check (source in ('booksy', 'google_business_profile', 'google_reviews', 'square', 'manual')),
  source_staff_id text,
  source_display_name text,
  source_email text,
  preferred_name text,
  business_location text,
  services jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_aliases (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete cascade,
  source text not null default 'booksy',
  alias text not null,
  alias_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('booksy_gmail', 'booksy_csv', 'google_business_profile')),
  business_unit_id uuid references public.business_units(id) on delete set null,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  parser_version text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  requested_by uuid references auth.users(id) on delete set null,
  processed_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  duplicate_count integer not null default 0,
  unresolved_count integer not null default 0,
  error_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  source text not null check (source in ('booksy_email', 'booksy_csv', 'square', 'manual')),
  source_event_id text,
  source_message_id text,
  source_thread_id text,
  sync_run_id uuid references public.sync_runs(id) on delete set null,
  event_type text not null check (
    event_type in (
      'appointment_created',
      'appointment_cancelled',
      'appointment_rescheduled',
      'appointment_updated',
      'client_created',
      'schedule_activity',
      'time_off_activity',
      'new_review',
      'unknown'
    )
  ),
  booking_identifier text,
  client_name text,
  client_email text,
  client_phone text,
  service_name text,
  appointment_start_at timestamptz,
  appointment_end_at timestamptz,
  source_timestamp timestamptz,
  price numeric(10, 2),
  location text,
  rating integer check (rating is null or rating between 1 and 5),
  review_text text,
  assignment_status text not null default 'unresolved'
    check (assignment_status in ('auto_assigned', 'flagged_for_audit', 'unresolved', 'general_business', 'unassigned')),
  assignment_confidence numeric(5, 2) not null default 0
    check (assignment_confidence >= 0 and assignment_confidence <= 100),
  assignment_reason text,
  parser_version text not null default 'booksy-email-v1',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  source text not null check (source in ('booksy_email', 'booksy_csv', 'google_business_profile', 'manual')),
  external_review_id text,
  source_message_id text,
  sync_run_id uuid references public.sync_runs(id) on delete set null,
  reviewer_name text,
  customer_name text,
  customer_email text,
  rating integer check (rating is null or rating between 1 and 5),
  review_text text,
  review_url text,
  source_timestamp timestamptz,
  published_at timestamptz,
  location text,
  service_name text,
  assignment_status text not null default 'unresolved'
    check (assignment_status in ('auto_assigned', 'flagged_for_audit', 'unresolved', 'general_business', 'unassigned')),
  assignment_confidence numeric(5, 2) not null default 0
    check (assignment_confidence >= 0 and assignment_confidence <= 100),
  assignment_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignment_matches (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  source_type text not null check (source_type in ('booksy_email', 'booksy_csv', 'google_review', 'manual')),
  source_table text not null check (source_table in ('activity_events', 'reviews')),
  source_record_id uuid not null,
  staff_id uuid references public.staff(id) on delete set null,
  confidence_score numeric(5, 2) not null default 0
    check (confidence_score >= 0 and confidence_score <= 100),
  status text not null default 'proposed'
    check (status in ('proposed', 'auto_assigned', 'flagged_for_audit', 'approved', 'corrected', 'rejected', 'unassigned', 'general_business')),
  match_reasons jsonb not null default '[]'::jsonb,
  alternative_matches jsonb not null default '[]'::jsonb,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.unresolved_items (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  item_type text not null check (item_type in ('activity_event', 'review', 'unknown_template')),
  source_table text not null check (source_table in ('activity_events', 'reviews', 'sync_runs')),
  source_record_id uuid not null,
  status text not null default 'unresolved'
    check (status in ('unresolved', 'approved', 'corrected', 'unassigned', 'general_business', 'ignored')),
  proposed_staff_id uuid references public.staff(id) on delete set null,
  confidence_score numeric(5, 2) not null default 0
    check (confidence_score >= 0 and confidence_score <= 100),
  matching_reasons jsonb not null default '[]'::jsonb,
  alternative_matches jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  manager_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_record_id)
);

alter table public.staff
  add column if not exists preferred_name text,
  add column if not exists business_location text;

create unique index if not exists staff_source_identities_source_staff_id_idx
on public.staff_source_identities(source, business_unit_id, source_staff_id)
where source_staff_id is not null;

create unique index if not exists staff_source_identities_source_email_idx
on public.staff_source_identities(source, business_unit_id, lower(source_email))
where source_email is not null;

create unique index if not exists staff_aliases_unique_idx
on public.staff_aliases(business_unit_id, source, alias_key, staff_id);

create index if not exists staff_source_identities_staff_idx
on public.staff_source_identities(staff_id, source);

create index if not exists staff_aliases_staff_idx
on public.staff_aliases(staff_id, source);

create unique index if not exists activity_events_source_event_idx
on public.activity_events(source, business_unit_id, source_event_id)
where source_event_id is not null;

create unique index if not exists activity_events_message_event_idx
on public.activity_events(source, business_unit_id, source_message_id, event_type, coalesce(booking_identifier, ''))
where source_message_id is not null;

create index if not exists activity_events_business_time_idx
on public.activity_events(business_unit_id, source_timestamp desc, created_at desc);

create index if not exists activity_events_staff_time_idx
on public.activity_events(staff_id, appointment_start_at desc);

create unique index if not exists reviews_external_review_idx
on public.reviews(source, business_unit_id, external_review_id)
where external_review_id is not null;

create unique index if not exists reviews_source_message_idx
on public.reviews(source, business_unit_id, source_message_id)
where source_message_id is not null;

create index if not exists reviews_business_time_idx
on public.reviews(business_unit_id, source_timestamp desc, created_at desc);

create index if not exists reviews_staff_time_idx
on public.reviews(staff_id, source_timestamp desc);

create index if not exists assignment_matches_source_idx
on public.assignment_matches(source_table, source_record_id, confidence_score desc);

create index if not exists unresolved_items_business_status_idx
on public.unresolved_items(business_unit_id, status, created_at desc);

create index if not exists sync_runs_source_business_idx
on public.sync_runs(source, business_unit_id, started_at desc);

alter table public.staff_source_identities enable row level security;
alter table public.staff_aliases enable row level security;
alter table public.activity_events enable row level security;
alter table public.reviews enable row level security;
alter table public.assignment_matches enable row level security;
alter table public.unresolved_items enable row level security;
alter table public.sync_runs enable row level security;

grant select, insert, update, delete on public.staff_source_identities to authenticated;
grant select, insert, update, delete on public.staff_aliases to authenticated;
grant select, insert, update, delete on public.activity_events to authenticated;
grant select, insert, update, delete on public.reviews to authenticated;
grant select, insert, update, delete on public.assignment_matches to authenticated;
grant select, insert, update, delete on public.unresolved_items to authenticated;
grant select, insert, update, delete on public.sync_runs to authenticated;

drop policy if exists staff_source_identities_select on public.staff_source_identities;
create policy staff_source_identities_select
on public.staff_source_identities for select to authenticated
using (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'performance', 'operations'], 'view'));

drop policy if exists staff_source_identities_insert on public.staff_source_identities;
create policy staff_source_identities_insert
on public.staff_source_identities for insert to authenticated
with check (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'operations'], 'edit'));

drop policy if exists staff_source_identities_update on public.staff_source_identities;
create policy staff_source_identities_update
on public.staff_source_identities for update to authenticated
using (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'operations'], 'edit'))
with check (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'operations'], 'edit'));

drop policy if exists staff_source_identities_delete on public.staff_source_identities;
create policy staff_source_identities_delete
on public.staff_source_identities for delete to authenticated
using (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'operations'], 'admin'));

drop policy if exists staff_aliases_select on public.staff_aliases;
create policy staff_aliases_select
on public.staff_aliases for select to authenticated
using (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'performance', 'operations'], 'view'));

drop policy if exists staff_aliases_insert on public.staff_aliases;
create policy staff_aliases_insert
on public.staff_aliases for insert to authenticated
with check (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'operations'], 'edit'));

drop policy if exists staff_aliases_update on public.staff_aliases;
create policy staff_aliases_update
on public.staff_aliases for update to authenticated
using (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'operations'], 'edit'))
with check (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'operations'], 'edit'));

drop policy if exists staff_aliases_delete on public.staff_aliases;
create policy staff_aliases_delete
on public.staff_aliases for delete to authenticated
using (private.can_access_business_any_module(business_unit_id, array['roster', 'appointments', 'operations'], 'admin'));

drop policy if exists activity_events_select on public.activity_events;
create policy activity_events_select
on public.activity_events for select to authenticated
using (private.can_access_business_any_module(business_unit_id, array['appointments', 'performance', 'operations'], 'view'));

drop policy if exists activity_events_insert on public.activity_events;
create policy activity_events_insert
on public.activity_events for insert to authenticated
with check (private.can_access_business_any_module(business_unit_id, array['appointments', 'operations'], 'edit'));

drop policy if exists activity_events_update on public.activity_events;
create policy activity_events_update
on public.activity_events for update to authenticated
using (private.can_access_business_any_module(business_unit_id, array['appointments', 'performance', 'operations'], 'edit'))
with check (private.can_access_business_any_module(business_unit_id, array['appointments', 'performance', 'operations'], 'edit'));

drop policy if exists activity_events_delete on public.activity_events;
create policy activity_events_delete
on public.activity_events for delete to authenticated
using (private.can_access_business_any_module(business_unit_id, array['appointments', 'operations'], 'admin'));

drop policy if exists reviews_select on public.reviews;
create policy reviews_select
on public.reviews for select to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'view'));

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert
on public.reviews for insert to authenticated
with check (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'));

drop policy if exists reviews_update on public.reviews;
create policy reviews_update
on public.reviews for update to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'))
with check (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'));

drop policy if exists reviews_delete on public.reviews;
create policy reviews_delete
on public.reviews for delete to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'admin'));

drop policy if exists assignment_matches_select on public.assignment_matches;
create policy assignment_matches_select
on public.assignment_matches for select to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'view'));

drop policy if exists assignment_matches_insert on public.assignment_matches;
create policy assignment_matches_insert
on public.assignment_matches for insert to authenticated
with check (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'));

drop policy if exists assignment_matches_update on public.assignment_matches;
create policy assignment_matches_update
on public.assignment_matches for update to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'))
with check (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'));

drop policy if exists assignment_matches_delete on public.assignment_matches;
create policy assignment_matches_delete
on public.assignment_matches for delete to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'admin'));

drop policy if exists unresolved_items_select on public.unresolved_items;
create policy unresolved_items_select
on public.unresolved_items for select to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'view'));

drop policy if exists unresolved_items_insert on public.unresolved_items;
create policy unresolved_items_insert
on public.unresolved_items for insert to authenticated
with check (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'));

drop policy if exists unresolved_items_update on public.unresolved_items;
create policy unresolved_items_update
on public.unresolved_items for update to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'))
with check (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'edit'));

drop policy if exists unresolved_items_delete on public.unresolved_items;
create policy unresolved_items_delete
on public.unresolved_items for delete to authenticated
using (private.can_access_business_any_module(business_unit_id, array['performance', 'operations', 'appointments'], 'admin'));

drop policy if exists sync_runs_select on public.sync_runs;
create policy sync_runs_select
on public.sync_runs for select to authenticated
using (
  business_unit_id is null
  or private.can_access_business_any_module(business_unit_id, array['appointments', 'performance', 'operations', 'settings'], 'view')
);

drop policy if exists sync_runs_insert on public.sync_runs;
create policy sync_runs_insert
on public.sync_runs for insert to authenticated
with check (
  business_unit_id is null
  or private.can_access_business_any_module(business_unit_id, array['appointments', 'operations', 'settings'], 'edit')
);

drop policy if exists sync_runs_update on public.sync_runs;
create policy sync_runs_update
on public.sync_runs for update to authenticated
using (
  business_unit_id is null
  or private.can_access_business_any_module(business_unit_id, array['appointments', 'operations', 'settings'], 'edit')
)
with check (
  business_unit_id is null
  or private.can_access_business_any_module(business_unit_id, array['appointments', 'operations', 'settings'], 'edit')
);

drop policy if exists sync_runs_delete on public.sync_runs;
create policy sync_runs_delete
on public.sync_runs for delete to authenticated
using (
  business_unit_id is null
  or private.can_access_business_any_module(business_unit_id, array['appointments', 'operations', 'settings'], 'admin')
);

create or replace view public.staff_activity_review_summary
with (security_invoker = true)
as
with activity_totals as (
  select
    staff_id,
    business_unit_id,
    count(*) filter (where event_type = 'appointment_created')::integer as appointments_created,
    count(*) filter (where event_type = 'appointment_cancelled')::integer as cancellations,
    count(*) filter (where event_type = 'appointment_rescheduled')::integer as reschedules,
    count(*) filter (where event_type = 'client_created')::integer as client_activity,
    max(coalesce(source_timestamp, created_at)) as latest_activity_at
  from public.activity_events
  where staff_id is not null
  group by staff_id, business_unit_id
),
review_totals as (
  select
    staff_id,
    business_unit_id,
    count(*)::integer as review_count,
    round(avg(rating)::numeric, 2) as average_rating,
    count(*) filter (where rating = 5)::integer as five_star_reviews,
    max(coalesce(source_timestamp, created_at)) as latest_review_at
  from public.reviews
  where staff_id is not null
  group by staff_id, business_unit_id
)
select
  st.id as staff_id,
  st.business_unit_id,
  coalesce(at.appointments_created, 0) as appointments_created,
  coalesce(at.cancellations, 0) as cancellations,
  coalesce(at.reschedules, 0) as reschedules,
  coalesce(at.client_activity, 0) as client_activity,
  coalesce(rt.review_count, 0) as review_count,
  rt.average_rating,
  coalesce(rt.five_star_reviews, 0) as five_star_reviews,
  greatest(at.latest_activity_at, rt.latest_review_at) as latest_source_activity_at
from public.staff st
left join activity_totals at on at.staff_id = st.id and at.business_unit_id = st.business_unit_id
left join review_totals rt on rt.staff_id = st.id and rt.business_unit_id = st.business_unit_id;

grant select on public.staff_activity_review_summary to authenticated;

create or replace view public.attribution_review_queue
with (security_invoker = true)
as
select
  ui.id,
  ui.business_unit_id,
  bu.name as business_name,
  ui.item_type,
  ui.source_table,
  ui.source_record_id,
  ui.status,
  ui.proposed_staff_id,
  st.full_name as proposed_staff_name,
  ui.confidence_score,
  ui.matching_reasons,
  ui.alternative_matches,
  ui.raw_payload,
  ui.manager_note,
  ui.created_at,
  ui.updated_at,
  coalesce(ae.event_type, 'review') as activity_type,
  coalesce(ae.client_name, rv.reviewer_name, rv.customer_name) as customer_name,
  coalesce(ae.service_name, rv.service_name) as service_name,
  coalesce(ae.appointment_start_at, rv.source_timestamp, rv.published_at) as source_time,
  coalesce(ae.location, rv.location) as location,
  coalesce(ae.review_text, rv.review_text) as review_text,
  coalesce(ae.rating, rv.rating) as rating
from public.unresolved_items ui
left join public.business_units bu on bu.id = ui.business_unit_id
left join public.staff st on st.id = ui.proposed_staff_id
left join public.activity_events ae on ui.source_table = 'activity_events' and ae.id = ui.source_record_id
left join public.reviews rv on ui.source_table = 'reviews' and rv.id = ui.source_record_id;

grant select on public.attribution_review_queue to authenticated;

create or replace function public.resolve_assignment_item(
  p_unresolved_item_id uuid,
  p_action text,
  p_staff_id uuid default null,
  p_note text default null
)
returns public.unresolved_items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_item public.unresolved_items;
  target_staff uuid;
  next_status text;
  next_assignment_status text;
begin
  select *
  into target_item
  from public.unresolved_items
  where id = p_unresolved_item_id
  for update;

  if target_item.id is null then
    raise exception 'Unresolved item not found.';
  end if;

  if not private.can_access_business_any_module(
    target_item.business_unit_id,
    array['appointments', 'performance', 'operations'],
    'edit'
  ) then
    raise exception 'Appointments, performance, or operations edit access is required.';
  end if;

  if p_action not in ('approve', 'correct', 'unassign', 'general_business', 'ignore') then
    raise exception 'Unsupported assignment action.';
  end if;

  target_staff := case
    when p_action in ('approve', 'correct') then coalesce(p_staff_id, target_item.proposed_staff_id)
    else null
  end;

  if p_action in ('approve', 'correct') and target_staff is null then
    raise exception 'Choose a staff member before assigning this item.';
  end if;

  next_status := case
    when p_action = 'approve' then 'approved'
    when p_action = 'correct' then 'corrected'
    when p_action = 'unassign' then 'unassigned'
    when p_action = 'general_business' then 'general_business'
    else 'ignored'
  end;

  next_assignment_status := case
    when p_action in ('approve', 'correct') then 'auto_assigned'
    when p_action = 'general_business' then 'general_business'
    else 'unassigned'
  end;

  if target_item.source_table = 'activity_events' then
    update public.activity_events
    set
      staff_id = target_staff,
      assignment_status = next_assignment_status,
      assignment_confidence = case when target_staff is null then 0 else greatest(95, assignment_confidence) end,
      assignment_reason = coalesce(p_note, assignment_reason, 'Manager reviewed attribution.'),
      updated_at = now()
    where id = target_item.source_record_id;
  elsif target_item.source_table = 'reviews' then
    update public.reviews
    set
      staff_id = target_staff,
      assignment_status = next_assignment_status,
      assignment_confidence = case when target_staff is null then 0 else greatest(95, assignment_confidence) end,
      assignment_reason = coalesce(p_note, assignment_reason, 'Manager reviewed attribution.'),
      updated_at = now()
    where id = target_item.source_record_id;
  end if;

  update public.assignment_matches
  set
    staff_id = target_staff,
    status = case
      when p_action = 'approve' then 'approved'
      when p_action = 'correct' then 'corrected'
      when p_action = 'general_business' then 'general_business'
      else 'unassigned'
    end,
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    updated_at = now()
  where source_table = target_item.source_table
    and source_record_id = target_item.source_record_id;

  update public.unresolved_items
  set
    status = next_status,
    proposed_staff_id = target_staff,
    manager_note = p_note,
    reviewed_by = (select auth.uid()),
    reviewed_at = now(),
    updated_at = now()
  where id = target_item.id
  returning * into target_item;

  return target_item;
end;
$function$;

grant execute on function public.resolve_assignment_item(uuid, text, uuid, text) to authenticated;

commit;
