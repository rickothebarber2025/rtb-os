-- Support non-employee users such as cleaners, maintenance vendors, and other contractors.

alter table public.user_profiles
  add column if not exists user_type text not null default 'employee';

alter table public.user_profiles
  drop constraint if exists user_profiles_user_type_check;

alter table public.user_profiles
  add constraint user_profiles_user_type_check
  check (user_type in ('employee', 'contractor', 'vendor', 'temporary', 'owner', 'admin'));

alter table public.staff
  add column if not exists employment_type text not null default 'employee';

alter table public.staff
  drop constraint if exists staff_employment_type_check;

alter table public.staff
  add constraint staff_employment_type_check
  check (employment_type in ('employee', 'contractor', 'vendor', 'temporary'));

comment on column public.user_profiles.user_type is
  'Relationship to RTB. Contractors and vendors can receive operational access without employee payroll permissions.';

comment on column public.staff.employment_type is
  'Work-profile classification. A contractor profile enables assignments and checklists but does not imply employment.';

-- Mark Haleigh as a contractor login and preserve her restricted operations permissions.
update public.user_profiles
set role = 'contractor',
    user_type = 'contractor',
    updated_at = now()
where lower(email) = 'haleighhall5566@gmail.com';

-- RTB operational features currently reference a work-profile id for shifts, tasks,
-- checklist evidence, and issue reports. Create a contractor work profile, not an
-- employee payroll profile, and explicitly exclude it from commission/leaderboards.
insert into public.staff (
  auth_user_id,
  email,
  full_name,
  preferred_name,
  role,
  employment_type,
  business_unit_id,
  business_location,
  commission_rate,
  fixed_rate,
  tier,
  active,
  exclude_from_leaderboard,
  notes
)
select
  up.id,
  up.email,
  coalesce(nullif(up.full_name, ''), 'Haleigh Hall'),
  'Haleigh',
  'Operations Cleaning Contractor',
  'contractor',
  up.business_unit_id,
  'All Businesses',
  0,
  true,
  'contractor',
  true,
  true,
  'Independent contractor profile. Operational access only; no employee payroll, commission, appointment, roster-management, or performance access.'
from public.user_profiles up
where lower(up.email) = 'haleighhall5566@gmail.com'
  and not exists (
    select 1
    from public.staff s
    where lower(s.email) = lower(up.email)
       or s.auth_user_id = up.id
  );

-- Ensure any existing matching work profile is classified safely.
update public.staff
set auth_user_id = coalesce(auth_user_id, (
      select id from public.user_profiles where lower(email) = 'haleighhall5566@gmail.com' limit 1
    )),
    employment_type = 'contractor',
    role = 'Operations Cleaning Contractor',
    commission_rate = 0,
    fixed_rate = true,
    tier = 'contractor',
    active = true,
    exclude_from_leaderboard = true,
    notes = 'Independent contractor profile. Operational access only; no employee payroll, commission, appointment, roster-management, or performance access.'
where lower(email) = 'haleighhall5566@gmail.com';
