begin;

create table if not exists public.staff_onboarding_invitations (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  user_profile_id uuid references public.user_profiles(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  talent_candidate_id uuid references public.talent_candidates(id) on delete set null,
  email text not null,
  full_name text not null,
  position_title text,
  start_date date,
  availability_notes text,
  emergency_contact jsonb not null default '{}'::jsonb,
  required_documents jsonb not null default '[]'::jsonb,
  target_role_template text not null default 'staff_portal',
  target_permissions jsonb,
  status text not null default 'invited'
    check (status in ('invited','in_progress','submitted','approved','needs_changes','archived','cancelled')),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  manager_note text,
  certificate_number text,
  certificate_issued_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_profile_id),
  unique(certificate_number)
);

create table if not exists public.staff_onboarding_stage_progress (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.staff_onboarding_invitations(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  stage_id text not null check (stage_id in (
    'personal_setup',
    'rtb_standards',
    'operational_training',
    'knowledge_checks',
    'practical_certification',
    'final_acknowledgement'
  )),
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','completed','needs_review')),
  metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  manager_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(invitation_id, stage_id)
);

create table if not exists public.staff_onboarding_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.staff_onboarding_invitations(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  section_id text not null,
  score numeric(5,2) not null default 0 check (score between 0 and 100),
  passing_score numeric(5,2) not null default 80 check (passing_score between 0 and 100),
  passed boolean generated always as (score >= passing_score) stored,
  answers jsonb not null default '{}'::jsonb,
  attempted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  manager_note text
);

create table if not exists public.staff_onboarding_policy_signatures (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.staff_onboarding_invitations(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  policy_id uuid not null references public.policy_documents(id) on delete restrict,
  staff_id uuid references public.staff(id) on delete set null,
  policy_title text not null,
  policy_version text not null,
  signer_name text not null,
  signature_text text not null,
  signed_at timestamptz not null default now(),
  ip_context text,
  unique(invitation_id, policy_id, policy_version)
);

create table if not exists public.staff_onboarding_certificates (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.staff_onboarding_invitations(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  certificate_number text not null unique,
  issued_to text not null,
  issued_at timestamptz not null default now(),
  policy_versions jsonb not null default '[]'::jsonb,
  stage_completion jsonb not null default '[]'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text
);

create table if not exists public.staff_probation_reviews (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid references public.staff_onboarding_invitations(id) on delete set null,
  staff_id uuid references public.staff(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  review_day integer not null check (review_day in (7,30,60,90)),
  scheduled_date date not null,
  completed_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled','completed','missed','cancelled','archived')),
  staff_kpis jsonb not null default '{}'::jsonb,
  rtb_support_kpis jsonb not null default '{}'::jsonb,
  manager_notes text,
  staff_notes text,
  recommendation text check (recommendation in ('advance','continue','improvement_plan','exit')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id, review_day),
  unique(invitation_id, review_day)
);

create index if not exists staff_onboarding_invitation_business_status_idx
on public.staff_onboarding_invitations (business_unit_id, status, created_at desc);
create index if not exists staff_onboarding_invitation_staff_idx
on public.staff_onboarding_invitations (staff_id);
create index if not exists staff_onboarding_invitation_user_profile_idx
on public.staff_onboarding_invitations (user_profile_id);
create index if not exists staff_onboarding_invitation_candidate_idx
on public.staff_onboarding_invitations (talent_candidate_id);
create index if not exists staff_onboarding_invitation_invited_by_idx
on public.staff_onboarding_invitations (invited_by);
create index if not exists staff_onboarding_invitation_approved_by_idx
on public.staff_onboarding_invitations (approved_by);
create index if not exists staff_onboarding_stage_invitation_idx
on public.staff_onboarding_stage_progress (invitation_id, stage_id);
create index if not exists staff_onboarding_stage_staff_idx
on public.staff_onboarding_stage_progress (staff_id);
create index if not exists staff_onboarding_stage_reviewed_by_idx
on public.staff_onboarding_stage_progress (reviewed_by);
create index if not exists staff_onboarding_quiz_invitation_idx
on public.staff_onboarding_quiz_attempts (invitation_id, section_id, attempted_at desc);
create index if not exists staff_onboarding_quiz_staff_idx
on public.staff_onboarding_quiz_attempts (staff_id);
create index if not exists staff_onboarding_quiz_reviewed_by_idx
on public.staff_onboarding_quiz_attempts (reviewed_by);
create index if not exists staff_onboarding_signature_invitation_idx
on public.staff_onboarding_policy_signatures (invitation_id, signed_at desc);
create index if not exists staff_onboarding_signature_policy_idx
on public.staff_onboarding_policy_signatures (policy_id);
create index if not exists staff_onboarding_signature_staff_idx
on public.staff_onboarding_policy_signatures (staff_id);
create index if not exists staff_onboarding_certificate_staff_idx
on public.staff_onboarding_certificates (staff_id);
create index if not exists staff_onboarding_certificate_invitation_idx
on public.staff_onboarding_certificates (invitation_id);
create index if not exists staff_onboarding_certificate_approved_by_idx
on public.staff_onboarding_certificates (approved_by);
create index if not exists staff_onboarding_certificate_revoked_by_idx
on public.staff_onboarding_certificates (revoked_by);
create index if not exists staff_probation_reviews_business_status_idx
on public.staff_probation_reviews (business_unit_id, status, scheduled_date);
create index if not exists staff_probation_reviews_staff_idx
on public.staff_probation_reviews (staff_id);
create index if not exists staff_probation_reviews_invitation_idx
on public.staff_probation_reviews (invitation_id);
create index if not exists staff_probation_reviews_created_by_idx
on public.staff_probation_reviews (created_by);

alter table public.staff_onboarding_invitations enable row level security;
alter table public.staff_onboarding_stage_progress enable row level security;
alter table public.staff_onboarding_quiz_attempts enable row level security;
alter table public.staff_onboarding_policy_signatures enable row level security;
alter table public.staff_onboarding_certificates enable row level security;
alter table public.staff_probation_reviews enable row level security;

grant select, insert, update, delete on public.staff_onboarding_invitations to authenticated;
grant select, insert, update, delete on public.staff_onboarding_stage_progress to authenticated;
grant select, insert, update, delete on public.staff_onboarding_quiz_attempts to authenticated;
grant select, insert, update, delete on public.staff_onboarding_policy_signatures to authenticated;
grant select, insert, update, delete on public.staff_onboarding_certificates to authenticated;
grant select, insert, update, delete on public.staff_probation_reviews to authenticated;

create or replace function private.onboarding_business_unit_id(p_invitation_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select business_unit_id
  from public.staff_onboarding_invitations
  where id = p_invitation_id
$$;

create or replace function private.can_access_onboarding_invitation(p_invitation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_onboarding_invitations invitation
    where invitation.id = p_invitation_id
      and (
        invitation.user_profile_id = (select auth.uid())
        or invitation.staff_id = private.current_staff_id()
        or private.staff_hub_business_admin(invitation.business_unit_id, 'view')
      )
  )
$$;

revoke all on function private.onboarding_business_unit_id(uuid) from public, anon, authenticated;
revoke all on function private.can_access_onboarding_invitation(uuid) from public, anon, authenticated;

create policy staff_onboarding_invitations_select
on public.staff_onboarding_invitations
for select to authenticated
using (
  user_profile_id = (select auth.uid())
  or staff_id = private.current_staff_id()
  or private.staff_hub_business_admin(business_unit_id, 'view')
);

create policy staff_onboarding_invitations_insert
on public.staff_onboarding_invitations
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_invitations_update
on public.staff_onboarding_invitations
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_invitations_delete
on public.staff_onboarding_invitations
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

create policy staff_onboarding_stage_progress_select
on public.staff_onboarding_stage_progress
for select to authenticated
using (private.can_access_onboarding_invitation(invitation_id));

create policy staff_onboarding_stage_progress_insert_manager
on public.staff_onboarding_stage_progress
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_stage_progress_update_manager
on public.staff_onboarding_stage_progress
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_stage_progress_delete_manager
on public.staff_onboarding_stage_progress
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

create policy staff_onboarding_quiz_attempts_select
on public.staff_onboarding_quiz_attempts
for select to authenticated
using (private.can_access_onboarding_invitation(invitation_id));

create policy staff_onboarding_quiz_attempts_insert_manager
on public.staff_onboarding_quiz_attempts
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_quiz_attempts_update_manager
on public.staff_onboarding_quiz_attempts
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_quiz_attempts_delete_manager
on public.staff_onboarding_quiz_attempts
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

create policy staff_onboarding_policy_signatures_select
on public.staff_onboarding_policy_signatures
for select to authenticated
using (private.can_access_onboarding_invitation(invitation_id));

create policy staff_onboarding_policy_signatures_insert_manager
on public.staff_onboarding_policy_signatures
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_policy_signatures_update_manager
on public.staff_onboarding_policy_signatures
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_policy_signatures_delete_manager
on public.staff_onboarding_policy_signatures
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

create policy staff_onboarding_certificates_select
on public.staff_onboarding_certificates
for select to authenticated
using (
  staff_id = private.current_staff_id()
  or private.can_access_onboarding_invitation(invitation_id)
  or private.staff_hub_business_admin(business_unit_id, 'view')
);

create policy staff_onboarding_certificates_insert_manager
on public.staff_onboarding_certificates
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_certificates_update_manager
on public.staff_onboarding_certificates
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_onboarding_certificates_delete_manager
on public.staff_onboarding_certificates
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

create policy staff_probation_reviews_select
on public.staff_probation_reviews
for select to authenticated
using (
  staff_id = private.current_staff_id()
  or private.staff_hub_business_admin(business_unit_id, 'view')
);

create policy staff_probation_reviews_insert
on public.staff_probation_reviews
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_probation_reviews_update
on public.staff_probation_reviews
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

create policy staff_probation_reviews_delete
on public.staff_probation_reviews
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

create or replace function private.touch_onboarding_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists staff_onboarding_invitations_touch on public.staff_onboarding_invitations;
create trigger staff_onboarding_invitations_touch
before update on public.staff_onboarding_invitations
for each row execute function private.touch_onboarding_updated_at();

drop trigger if exists staff_onboarding_stage_progress_touch on public.staff_onboarding_stage_progress;
create trigger staff_onboarding_stage_progress_touch
before update on public.staff_onboarding_stage_progress
for each row execute function private.touch_onboarding_updated_at();

drop trigger if exists staff_probation_reviews_touch on public.staff_probation_reviews;
create trigger staff_probation_reviews_touch
before update on public.staff_probation_reviews
for each row execute function private.touch_onboarding_updated_at();

create or replace function private.schedule_probation_reviews_for_onboarding()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  base_date date;
  day_value integer;
begin
  if new.staff_id is null or new.status in ('archived','cancelled') then
    return new;
  end if;

  base_date := coalesce(new.start_date, (
    select s.probation_start_date
    from public.staff s
    where s.id = new.staff_id
  ), current_date);

  foreach day_value in array array[7,30,60,90] loop
    insert into public.staff_probation_reviews (
      invitation_id,
      staff_id,
      business_unit_id,
      review_day,
      scheduled_date,
      rtb_support_kpis,
      staff_kpis
    )
    values (
      new.id,
      new.staff_id,
      new.business_unit_id,
      day_value,
      base_date + day_value,
      jsonb_build_object(
        'training_sessions_provided', 0,
        'bookings_offered', 0,
        'content_exposure_count', 0,
        'qualified_leads_shared', 0,
        'manager_support_notes', ''
      ),
      jsonb_build_object(
        'attendance', 0,
        'professionalism', 0,
        'service_quality', 0,
        'client_experience', 0,
        'policy_compliance', 0
      )
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists staff_onboarding_schedule_probation on public.staff_onboarding_invitations;
create trigger staff_onboarding_schedule_probation
after insert or update of staff_id, start_date, status on public.staff_onboarding_invitations
for each row execute function private.schedule_probation_reviews_for_onboarding();

create or replace function public.submit_staff_onboarding_stage(
  p_invitation_id uuid,
  p_stage_id text,
  p_metadata jsonb default '{}'::jsonb,
  p_completed boolean default true
)
returns public.staff_onboarding_stage_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.staff_onboarding_invitations%rowtype;
  saved public.staff_onboarding_stage_progress%rowtype;
begin
  select *
  into invitation
  from public.staff_onboarding_invitations
  where id = p_invitation_id
  for update;

  if invitation.id is null then
    raise exception 'Onboarding invitation not found.';
  end if;

  if not (
    invitation.user_profile_id = (select auth.uid())
    or invitation.staff_id = private.current_staff_id()
    or private.staff_hub_business_admin(invitation.business_unit_id, 'edit')
  ) then
    raise exception 'Onboarding access denied.';
  end if;

  if invitation.status in ('approved','archived','cancelled') then
    raise exception 'This onboarding record is closed.';
  end if;

  if p_stage_id = 'practical_certification'
    and not private.staff_hub_business_admin(invitation.business_unit_id, 'edit') then
    raise exception 'Manager approval is required for practical certification.';
  end if;

  insert into public.staff_onboarding_stage_progress (
    invitation_id,
    business_unit_id,
    staff_id,
    stage_id,
    status,
    metadata,
    completed_at
  )
  values (
    invitation.id,
    invitation.business_unit_id,
    invitation.staff_id,
    p_stage_id,
    case when p_completed then 'completed' else 'in_progress' end,
    coalesce(p_metadata, '{}'::jsonb),
    case when p_completed then now() else null end
  )
  on conflict (invitation_id, stage_id)
  do update set
    staff_id = excluded.staff_id,
    status = excluded.status,
    metadata = excluded.metadata,
    completed_at = excluded.completed_at,
    updated_at = now()
  returning * into saved;

  update public.staff_onboarding_invitations
  set status = case when status = 'invited' then 'in_progress' else status end
  where id = invitation.id;

  return saved;
end;
$$;

create or replace function public.submit_staff_onboarding_quiz(
  p_invitation_id uuid,
  p_section_id text,
  p_score numeric,
  p_passing_score numeric default 80,
  p_answers jsonb default '{}'::jsonb
)
returns public.staff_onboarding_quiz_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.staff_onboarding_invitations%rowtype;
  saved public.staff_onboarding_quiz_attempts%rowtype;
begin
  select *
  into invitation
  from public.staff_onboarding_invitations
  where id = p_invitation_id;

  if invitation.id is null then
    raise exception 'Onboarding invitation not found.';
  end if;

  if not (
    invitation.user_profile_id = (select auth.uid())
    or invitation.staff_id = private.current_staff_id()
    or private.staff_hub_business_admin(invitation.business_unit_id, 'edit')
  ) then
    raise exception 'Onboarding access denied.';
  end if;

  insert into public.staff_onboarding_quiz_attempts (
    invitation_id,
    business_unit_id,
    staff_id,
    section_id,
    score,
    passing_score,
    answers
  )
  values (
    invitation.id,
    invitation.business_unit_id,
    invitation.staff_id,
    p_section_id,
    greatest(0, least(100, coalesce(p_score, 0))),
    greatest(0, least(100, coalesce(p_passing_score, 80))),
    coalesce(p_answers, '{}'::jsonb)
  )
  returning * into saved;

  return saved;
end;
$$;

create or replace function public.sign_staff_onboarding_policy(
  p_invitation_id uuid,
  p_policy_id uuid,
  p_signer_name text,
  p_signature_text text
)
returns public.staff_onboarding_policy_signatures
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.staff_onboarding_invitations%rowtype;
  policy public.policy_documents%rowtype;
  saved public.staff_onboarding_policy_signatures%rowtype;
begin
  select *
  into invitation
  from public.staff_onboarding_invitations
  where id = p_invitation_id;

  if invitation.id is null then
    raise exception 'Onboarding invitation not found.';
  end if;

  if not (
    invitation.user_profile_id = (select auth.uid())
    or invitation.staff_id = private.current_staff_id()
  ) then
    raise exception 'Only the onboarding staff member can sign policies.';
  end if;

  select *
  into policy
  from public.policy_documents
  where id = p_policy_id
    and active
    and requires_acknowledgement
    and (business_unit_id is null or business_unit_id = invitation.business_unit_id);

  if policy.id is null then
    raise exception 'Policy is not available for this onboarding record.';
  end if;

  if length(trim(coalesce(p_signer_name, ''))) < 2
    or length(trim(coalesce(p_signature_text, ''))) < 2 then
    raise exception 'Signature name and signature text are required.';
  end if;

  insert into public.staff_onboarding_policy_signatures (
    invitation_id,
    business_unit_id,
    policy_id,
    staff_id,
    policy_title,
    policy_version,
    signer_name,
    signature_text
  )
  values (
    invitation.id,
    invitation.business_unit_id,
    policy.id,
    invitation.staff_id,
    policy.title,
    policy.version,
    trim(p_signer_name),
    trim(p_signature_text)
  )
  on conflict (invitation_id, policy_id, policy_version)
  do update set
    signer_name = excluded.signer_name,
    signature_text = excluded.signature_text,
    signed_at = now()
  returning * into saved;

  if invitation.staff_id is not null then
    insert into public.policy_acknowledgements (policy_id, staff_id, acknowledged_at)
    values (policy.id, invitation.staff_id, now())
    on conflict (policy_id, staff_id)
    do update set acknowledged_at = excluded.acknowledged_at;
  end if;

  return saved;
end;
$$;

create or replace function public.submit_staff_onboarding_for_approval(p_invitation_id uuid)
returns public.staff_onboarding_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.staff_onboarding_invitations%rowtype;
  required_count integer;
  completed_count integer;
  required_policy_count integer;
  signed_policy_count integer;
  missing_quiz_count integer;
begin
  select *
  into invitation
  from public.staff_onboarding_invitations
  where id = p_invitation_id
  for update;

  if invitation.id is null then
    raise exception 'Onboarding invitation not found.';
  end if;

  if not (
    invitation.user_profile_id = (select auth.uid())
    or invitation.staff_id = private.current_staff_id()
  ) then
    raise exception 'Only the onboarding staff member can submit this record.';
  end if;

  select count(*)
  into required_count
  from unnest(array[
    'personal_setup',
    'rtb_standards',
    'operational_training',
    'knowledge_checks',
    'practical_certification',
    'final_acknowledgement'
  ]) stage_id;

  select count(distinct stage_id)
  into completed_count
  from public.staff_onboarding_stage_progress
  where invitation_id = invitation.id
    and status = 'completed';

  if completed_count < required_count then
    raise exception 'Complete every onboarding stage before submitting.';
  end if;

  select count(*)
  into missing_quiz_count
  from unnest(array[
    'rtb_standards',
    'operational_training',
    'cash_payments',
    'conduct_confidentiality'
  ]) required(section_id)
  where not exists (
    select 1
    from public.staff_onboarding_quiz_attempts attempts
    where attempts.invitation_id = invitation.id
      and attempts.section_id = required.section_id
      and attempts.passed
  );

  if missing_quiz_count > 0 then
    raise exception 'Every knowledge check needs a passing score.';
  end if;

  select count(*)
  into required_policy_count
  from public.policy_documents p
  where p.active
    and p.requires_acknowledgement
    and (p.business_unit_id is null or p.business_unit_id = invitation.business_unit_id);

  select count(distinct p.id)
  into signed_policy_count
  from public.policy_documents p
  join public.staff_onboarding_policy_signatures s
    on s.policy_id = p.id
   and s.policy_version = p.version
   and s.invitation_id = invitation.id
  where p.active
    and p.requires_acknowledgement
    and (p.business_unit_id is null or p.business_unit_id = invitation.business_unit_id);

  if signed_policy_count < required_policy_count then
    raise exception 'Sign every required policy before submitting.';
  end if;

  update public.staff_onboarding_invitations
  set status = 'submitted',
      submitted_at = now()
  where id = invitation.id
  returning * into invitation;

  return invitation;
end;
$$;

create or replace function public.approve_staff_onboarding(
  p_invitation_id uuid,
  p_permissions jsonb default null,
  p_role text default 'staff',
  p_manager_note text default null
)
returns public.staff_onboarding_certificates
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.staff_onboarding_invitations%rowtype;
  cert public.staff_onboarding_certificates%rowtype;
  cert_number text;
  target_permissions jsonb;
begin
  select *
  into invitation
  from public.staff_onboarding_invitations
  where id = p_invitation_id
  for update;

  if invitation.id is null then
    raise exception 'Onboarding invitation not found.';
  end if;

  if not private.can_module_admin('access') then
    raise exception 'Access administrator approval is required to activate RTB OS permissions.';
  end if;

  if invitation.status <> 'submitted' then
    raise exception 'The staff member must submit onboarding before approval.';
  end if;

  target_permissions := invitation.target_permissions;
  if target_permissions is null then
    raise exception 'Choose the role access to grant after approval.';
  end if;

  if p_permissions is not null and p_permissions <> target_permissions then
    raise exception 'Approval permissions must match the access plan saved with the invitation.';
  end if;

  cert_number := coalesce(
    invitation.certificate_number,
    'RTB-ONB-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(invitation.id::text, '-', ''), 1, 6))
  );

  insert into public.staff_onboarding_certificates (
    invitation_id,
    business_unit_id,
    staff_id,
    certificate_number,
    issued_to,
    policy_versions,
    stage_completion,
    approved_by
  )
  select
    invitation.id,
    invitation.business_unit_id,
    invitation.staff_id,
    cert_number,
    invitation.full_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'policy_id', policy_id,
        'title', policy_title,
        'version', policy_version,
        'signed_at', signed_at
      ) order by signed_at)
      from public.staff_onboarding_policy_signatures
      where invitation_id = invitation.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'stage_id', stage_id,
        'status', status,
        'completed_at', completed_at
      ) order by stage_id)
      from public.staff_onboarding_stage_progress
      where invitation_id = invitation.id
    ), '[]'::jsonb),
    (select auth.uid())
  on conflict (certificate_number)
  do update set
    revoked_at = null,
    revoked_by = null,
    revoke_reason = null
  returning * into cert;

  update public.staff_onboarding_invitations
  set status = 'approved',
      approved_by = (select auth.uid()),
      approved_at = now(),
      manager_note = p_manager_note,
      certificate_number = cert_number,
      certificate_issued_at = cert.issued_at
  where id = invitation.id;

  if invitation.user_profile_id is not null then
    update public.user_profiles
    set active = true,
        role = coalesce(nullif(p_role, ''), 'staff'),
        permissions = target_permissions,
        role_title = target_permissions ->> 'role_title',
        role_description = target_permissions ->> 'role_description',
        expectations = target_permissions ->> 'expectations',
        responsibilities = coalesce(target_permissions -> 'responsibilities', '[]'::jsonb),
        restrictions = coalesce(target_permissions -> 'restrictions', '[]'::jsonb),
        updated_at = now()
    where id = invitation.user_profile_id;
  end if;

  return cert;
end;
$$;

create or replace function public.close_staff_onboarding(
  p_invitation_id uuid,
  p_status text,
  p_reason text default null
)
returns public.staff_onboarding_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation public.staff_onboarding_invitations%rowtype;
begin
  if not private.can_module_admin('access') then
    raise exception 'Access administrator permission is required.';
  end if;

  if p_status not in ('cancelled', 'archived') then
    raise exception 'Onboarding can only be cancelled or archived.';
  end if;

  select *
  into invitation
  from public.staff_onboarding_invitations
  where id = p_invitation_id
  for update;

  if invitation.id is null then
    raise exception 'Onboarding invitation not found.';
  end if;

  if p_status = 'cancelled' and invitation.status = 'approved' then
    raise exception 'Approved onboarding records must be archived, not cancelled.';
  end if;

  if p_status = 'archived' and invitation.status <> 'approved' then
    raise exception 'Only approved onboarding records can be archived.';
  end if;

  update public.staff_onboarding_invitations
  set status = p_status,
      manager_note = coalesce(nullif(trim(p_reason), ''), manager_note)
  where id = invitation.id
  returning * into invitation;

  if p_status = 'cancelled' and invitation.user_profile_id is not null then
    update public.user_profiles
    set active = false,
        updated_at = now()
    where id = invitation.user_profile_id;
  end if;

  return invitation;
end;
$$;

create or replace function public.save_staff_probation_review(
  p_review_id uuid,
  p_staff_kpis jsonb,
  p_rtb_support_kpis jsonb,
  p_manager_notes text default null,
  p_recommendation text default null,
  p_status text default 'completed'
)
returns public.staff_probation_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.staff_probation_reviews%rowtype;
begin
  select *
  into review
  from public.staff_probation_reviews
  where id = p_review_id
  for update;

  if review.id is null then
    raise exception 'Probation review not found.';
  end if;

  if not private.staff_hub_business_admin(review.business_unit_id, 'edit') then
    raise exception 'Manager review access required.';
  end if;

  update public.staff_probation_reviews
  set staff_kpis = coalesce(p_staff_kpis, '{}'::jsonb),
      rtb_support_kpis = coalesce(p_rtb_support_kpis, '{}'::jsonb),
      manager_notes = p_manager_notes,
      recommendation = nullif(p_recommendation, ''),
      status = coalesce(nullif(p_status, ''), 'completed'),
      completed_at = case when coalesce(nullif(p_status, ''), 'completed') = 'completed' then now() else completed_at end
  where id = p_review_id
  returning * into review;

  return review;
end;
$$;

revoke all on function public.submit_staff_onboarding_stage(uuid,text,jsonb,boolean) from public, anon;
revoke all on function public.submit_staff_onboarding_quiz(uuid,text,numeric,numeric,jsonb) from public, anon;
revoke all on function public.sign_staff_onboarding_policy(uuid,uuid,text,text) from public, anon;
revoke all on function public.submit_staff_onboarding_for_approval(uuid) from public, anon;
revoke all on function public.approve_staff_onboarding(uuid,jsonb,text,text) from public, anon;
revoke all on function public.close_staff_onboarding(uuid,text,text) from public, anon;
revoke all on function public.save_staff_probation_review(uuid,jsonb,jsonb,text,text,text) from public, anon;

grant execute on function public.submit_staff_onboarding_stage(uuid,text,jsonb,boolean) to authenticated;
grant execute on function public.submit_staff_onboarding_quiz(uuid,text,numeric,numeric,jsonb) to authenticated;
grant execute on function public.sign_staff_onboarding_policy(uuid,uuid,text,text) to authenticated;
grant execute on function public.submit_staff_onboarding_for_approval(uuid) to authenticated;
grant execute on function public.approve_staff_onboarding(uuid,jsonb,text,text) to authenticated;
grant execute on function public.close_staff_onboarding(uuid,text,text) to authenticated;
grant execute on function public.save_staff_probation_review(uuid,jsonb,jsonb,text,text,text) to authenticated;

commit;
