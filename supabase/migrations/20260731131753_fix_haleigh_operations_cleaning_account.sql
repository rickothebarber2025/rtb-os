begin;

-- Haleigh's cleaner login needs the contractor access template, an active
-- roster profile, and a legacy Staff Hub profile. Without the legacy profile,
-- older hub helpers can report "No staff profile is linked to this account."

create or replace function private.auto_provision_staff_hub_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  matched_staff record;
  is_operations_cleaner boolean := false;
  business_ids jsonb;
  business_scope text := 'selected';
begin
  if new.business_unit_id is not null then
    return new;
  end if;

  select id, business_unit_id, business_location, full_name, role, employment_type, tier
  into matched_staff
  from public.staff
  where active = true
    and lower(trim(email)) = lower(trim(new.email))
  order by created_at desc
  limit 1;

  if matched_staff.id is null then
    return new;
  end if;

  is_operations_cleaner :=
    matched_staff.employment_type = 'contractor'
    or matched_staff.tier = 'contractor'
    or matched_staff.role ilike '%cleaning%';

  if lower(coalesce(matched_staff.business_location, '')) = 'all businesses' then
    business_scope := 'all';
    business_ids := jsonb_build_array('all-businesses');
  else
    business_ids := case
      when matched_staff.business_unit_id is null then '[]'::jsonb
      else jsonb_build_array(matched_staff.business_unit_id)
    end;
  end if;

  new.active := true;
  new.business_unit_id := matched_staff.business_unit_id;

  if is_operations_cleaner then
    new.role := 'contractor';
    new.user_type := 'contractor';
    new.role_title := 'Operations Cleaning';
    new.role_description := 'Cleaning and opening support role with access only to Staff Hub and operational checklists.';
    new.expectations := 'Work the assigned 8:00 AM-10:00 AM cleaning shift, complete every required checklist item, upload the final walkthrough photo, and report supply or maintenance issues before opening.';
    new.responsibilities := jsonb_build_array(
      'Clock in and out for the assigned cleaning shift',
      'Complete the reception, washroom, barbershop, and Beauty Lounge opening checklist',
      'Restock shared cleaning and paper supplies',
      'Upload a final walkthrough photo before the shop opens',
      'Inspect shared areas and report failed station conditions with a photo and note',
      'Report low inventory, damaged equipment, and maintenance issues'
    );
    new.restrictions := jsonb_build_array(
      'No payroll or earnings access.',
      'No appointment or client access.',
      'No staff, user, or permission management.',
      'No business settings changes.',
      'No financial, booth-rent, or performance reports.',
      'Cannot edit checklist templates or operations configuration.'
    );
    new.permissions := jsonb_build_object(
      'modules', jsonb_build_object(
        'access', 'none',
        'appointments', 'none',
        'booth_rent', 'none',
        'dashboard', 'none',
        'operations', 'edit',
        'payroll', 'none',
        'performance', 'none',
        'roster', 'none',
        'settings', 'none',
        'staff_hub', 'view'
      ),
      'role_title', new.role_title,
      'role_description', new.role_description,
      'expectations', new.expectations,
      'responsibilities', new.responsibilities,
      'restrictions', new.restrictions,
      'role_template', 'operations_cleaning',
      'business_scope', business_scope,
      'business_unit_ids', business_ids
    );
  else
    new.role := 'staff';
    new.user_type := 'employee';
    new.business_unit_id := matched_staff.business_unit_id;
    new.role_title := 'Staff Portal';
    new.role_description := 'Staff-only login for Staff Hub with personal payroll and performance history.';
    new.expectations := 'Use Staff Hub to review role details, assigned business information, staff profile updates, earnings, and performance.';
    new.responsibilities := jsonb_build_array(
      'Review your Staff Hub updates',
      'Keep your staff profile details accurate',
      'Check your payroll and performance history',
      'Check your assigned business and role expectations',
      'Report schedule, profile, or access issues to management'
    );
    new.restrictions := jsonb_build_array(
      'No payroll editing.',
      'No access management.',
      'No business settings changes.',
      'No deleting or changing other staff records.'
    );
    new.permissions := jsonb_build_object(
      'modules', jsonb_build_object(
        'access', 'none',
        'appointments', 'none',
        'booth_rent', 'none',
        'dashboard', 'none',
        'operations', 'none',
        'payroll', 'none',
        'performance', 'none',
        'roster', 'none',
        'settings', 'none',
        'staff_hub', 'view'
      ),
      'role_title', new.role_title,
      'role_description', new.role_description,
      'expectations', new.expectations,
      'responsibilities', new.responsibilities,
      'restrictions', new.restrictions,
      'role_template', 'staff_portal',
      'business_scope', business_scope,
      'business_unit_ids', business_ids
    );
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_auto_provision_staff_hub_profile on public.user_profiles;
create trigger trg_auto_provision_staff_hub_profile
  before insert on public.user_profiles
  for each row
  execute function private.auto_provision_staff_hub_profile();

with haleigh as (
  select
    id,
    email,
    coalesce(nullif(full_name, ''), 'Haleigh') as full_name,
    business_unit_id
  from public.user_profiles
  where lower(email) = 'haleighhall5566@gmail.com'
  limit 1
)
update public.user_profiles up
set
  active = true,
  role = 'contractor',
  user_type = 'contractor',
  role_title = 'Operations Cleaning',
  role_description = 'Cleaning and opening support role with access only to Staff Hub and operational checklists.',
  expectations = 'Work the assigned 8:00 AM-10:00 AM cleaning shift, complete every required checklist item, upload the final walkthrough photo, and report supply or maintenance issues before opening.',
  responsibilities = jsonb_build_array(
    'Clock in and out for the assigned cleaning shift',
    'Complete the reception, washroom, barbershop, and Beauty Lounge opening checklist',
    'Restock shared cleaning and paper supplies',
    'Upload a final walkthrough photo before the shop opens',
    'Inspect shared areas and report failed station conditions with a photo and note',
    'Report low inventory, damaged equipment, and maintenance issues'
  ),
  restrictions = jsonb_build_array(
    'No payroll or earnings access.',
    'No appointment or client access.',
    'No staff, user, or permission management.',
    'No business settings changes.',
    'No financial, booth-rent, or performance reports.',
    'Cannot edit checklist templates or operations configuration.'
  ),
  permissions = jsonb_build_object(
    'modules', jsonb_build_object(
      'access', 'none',
      'appointments', 'none',
      'booth_rent', 'none',
      'dashboard', 'none',
      'operations', 'edit',
      'payroll', 'none',
      'performance', 'none',
      'roster', 'none',
      'settings', 'none',
      'staff_hub', 'view'
    ),
    'role_title', 'Operations Cleaning',
    'role_description', 'Cleaning and opening support role with access only to Staff Hub and operational checklists.',
    'expectations', 'Work the assigned 8:00 AM-10:00 AM cleaning shift, complete every required checklist item, upload the final walkthrough photo, and report supply or maintenance issues before opening.',
    'responsibilities', jsonb_build_array(
      'Clock in and out for the assigned cleaning shift',
      'Complete the reception, washroom, barbershop, and Beauty Lounge opening checklist',
      'Restock shared cleaning and paper supplies',
      'Upload a final walkthrough photo before the shop opens',
      'Inspect shared areas and report failed station conditions with a photo and note',
      'Report low inventory, damaged equipment, and maintenance issues'
    ),
    'restrictions', jsonb_build_array(
      'No payroll or earnings access.',
      'No appointment or client access.',
      'No staff, user, or permission management.',
      'No business settings changes.',
      'No financial, booth-rent, or performance reports.',
      'Cannot edit checklist templates or operations configuration.'
    ),
    'role_template', 'operations_cleaning',
    'business_scope', 'all',
    'business_unit_ids', jsonb_build_array('all-businesses')
  ),
  updated_at = now()
from haleigh h
where up.id = h.id;

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
  h.email,
  h.full_name,
  'Haleigh',
  'Operations Cleaning Contractor',
  'contractor',
  h.business_unit_id,
  'All Businesses',
  0,
  true,
  'contractor',
  true,
  true,
  'Independent contractor work profile. Operational access only; no employee payroll, commission, appointment, roster-management, or performance access.'
from (
  select email, coalesce(nullif(full_name, ''), 'Haleigh') as full_name, business_unit_id
  from public.user_profiles
  where lower(email) = 'haleighhall5566@gmail.com'
  limit 1
) h
where not exists (
  select 1 from public.staff s where lower(s.email) = lower(h.email)
);

update public.staff
set
  employment_type = 'contractor',
  role = 'Operations Cleaning Contractor',
  commission_rate = 0,
  fixed_rate = true,
  tier = 'contractor',
  active = true,
  exclude_from_leaderboard = true,
  business_location = 'All Businesses',
  notes = 'Independent contractor work profile. Operational access only; no employee payroll, commission, appointment, roster-management, or performance access.'
where lower(email) = 'haleighhall5566@gmail.com';

with haleigh as (
  select id, email, coalesce(nullif(full_name, ''), 'Haleigh') as full_name
  from public.user_profiles
  where lower(email) = 'haleighhall5566@gmail.com'
  limit 1
),
hub_business as (
  select id
  from public.hub_businesses
  order by case when name = 'RTB Lounge' then 0 else 1 end, name
  limit 1
)
update public.hub_staff_profiles hsp
set
  auth_user_id = haleigh.id,
  email = haleigh.email,
  full_name = haleigh.full_name,
  role = 'staff',
  job_title = 'Operations Cleaning Contractor',
  business_id = (select id from hub_business limit 1),
  commission_level = 'Booth Rent 100%',
  commission_rate = 0,
  is_active = true
from haleigh
where hsp.auth_user_id = haleigh.id
   or lower(hsp.email) = lower(haleigh.email);

with haleigh as (
  select id, email, coalesce(nullif(full_name, ''), 'Haleigh') as full_name
  from public.user_profiles
  where lower(email) = 'haleighhall5566@gmail.com'
  limit 1
),
hub_business as (
  select id
  from public.hub_businesses
  order by case when name = 'RTB Lounge' then 0 else 1 end, name
  limit 1
)
insert into public.hub_staff_profiles (
  auth_user_id,
  email,
  full_name,
  role,
  job_title,
  business_id,
  commission_level,
  commission_rate,
  is_active
)
select
  haleigh.id,
  haleigh.email,
  haleigh.full_name,
  'staff',
  'Operations Cleaning Contractor',
  (select id from hub_business limit 1),
  'Booth Rent 100%',
  0,
  true
from haleigh
where not exists (
  select 1
  from public.hub_staff_profiles hsp
  where hsp.auth_user_id = haleigh.id
     or lower(hsp.email) = lower(haleigh.email)
);

commit;
