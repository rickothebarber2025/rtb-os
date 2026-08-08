-- Support non-employee users such as cleaners, maintenance vendors, and other contractors.

alter table public.user_profiles
  add column if not exists user_type text not null default 'employee';

alter table public.user_profiles
  drop constraint if exists user_profiles_user_type_check;

alter table public.user_profiles
  add constraint user_profiles_user_type_check
  check (user_type in ('employee', 'contractor', 'vendor', 'temporary', 'owner', 'admin'));

alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('admin', 'manager', 'staff', 'contractor', 'vendor', 'pending'));

alter table public.staff
  add column if not exists employment_type text not null default 'employee';

alter table public.staff
  drop constraint if exists staff_employment_type_check;

alter table public.staff
  add constraint staff_employment_type_check
  check (employment_type in ('employee', 'contractor', 'vendor', 'temporary'));

alter table public.staff
  drop constraint if exists staff_tier_check;

alter table public.staff
  add constraint staff_tier_check
  check (tier in ('probation', 'standard', 'review', 'growth', 'elite', 'booth', 'contractor', 'vendor', 'temporary'));

comment on column public.user_profiles.user_type is
  'Relationship to RTB. Contractors and vendors can receive operational access without employee payroll permissions.';

comment on column public.staff.employment_type is
  'Work-profile classification. A contractor profile enables assignments and checklists but does not imply employment.';

update public.user_profiles
set role = 'contractor',
    user_type = 'contractor',
    updated_at = now()
where lower(email) = 'haleighhall5566@gmail.com';

insert into public.staff (
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
  'Independent contractor work profile. Operational access only; no employee payroll, commission, appointment, roster-management, or performance access.'
from public.user_profiles up
where lower(up.email) = 'haleighhall5566@gmail.com'
  and not exists (
    select 1 from public.staff s where lower(s.email) = lower(up.email)
  );

update public.staff
set employment_type = 'contractor',
    role = 'Operations Cleaning Contractor',
    commission_rate = 0,
    fixed_rate = true,
    tier = 'contractor',
    active = true,
    exclude_from_leaderboard = true,
    notes = 'Independent contractor work profile. Operational access only; no employee payroll, commission, appointment, roster-management, or performance access.'
where lower(email) = 'haleighhall5566@gmail.com';
