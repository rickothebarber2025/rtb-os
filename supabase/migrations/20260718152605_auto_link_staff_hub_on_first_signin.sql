begin;

-- Permanent fix for "No roster profile matched this login."
--
-- Root cause: a brand-new sign-in gets a bare "pending" user_profiles
-- row with no business assigned. With no business assigned, the app
-- can't tell which location the person belongs to, defaults to
-- whichever business is alphabetically first, and that default is
-- almost never the person's real business -- so their own roster row
-- gets filtered out before matching ever runs, even when their email
-- and name are perfectly correct.
--
-- Fix: the instant a new user_profiles row is created, check whether
-- the email matches an active roster (staff) entry. If it does,
-- immediately grant that person the same working Staff Hub template
-- already used for your existing staff: their real business, "view"
-- access to Staff Hub, and an active account. No admin step, for any
-- current or future hire.

create or replace function private.auto_provision_staff_hub_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  matched_staff record;
begin
  -- Only act on fresh, unconfigured signups. Never touch a profile
  -- that already has a business assigned (covers admin-configured
  -- profiles like Manager/all-business roles) or is already active.
  if new.business_unit_id is not null then
    return new;
  end if;

  select id, business_unit_id, full_name
  into matched_staff
  from public.staff
  where active = true
    and lower(trim(email)) = lower(trim(new.email))
  limit 1;

  if matched_staff.id is null then
    return new;
  end if;

  new.role := 'staff';
  new.active := true;
  new.business_unit_id := matched_staff.business_unit_id;
  new.permissions := jsonb_build_object(
    'modules', jsonb_build_object(
      'access', 'none', 'roster', 'none', 'payroll', 'none', 'settings', 'none',
      'dashboard', 'none', 'staff_hub', 'view', 'booth_rent', 'none',
      'operations', 'none', 'performance', 'none', 'appointments', 'none'
    ),
    'role_title', 'Staff Portal',
    'expectations', 'Use Staff Hub to review role details, assigned business information, staff profile updates, earnings, and performance.',
    'restrictions', jsonb_build_array(
      'No payroll editing.', 'No access management.', 'No business settings changes.',
      'No deleting or changing other staff records.'
    ),
    'role_template', 'staff_portal',
    'business_scope', 'selected',
    'responsibilities', jsonb_build_array(
      'Review your Staff Hub updates', 'Keep your staff profile details accurate',
      'Check your payroll and performance history', 'Check your assigned business and role expectations',
      'Report schedule, profile, or access issues to management'
    ),
    'role_description', 'Staff-only login for Staff Hub with personal payroll and performance history.',
    'business_unit_ids', jsonb_build_array(matched_staff.business_unit_id)
  );

  return new;
end;
$fn$;

drop trigger if exists trg_auto_provision_staff_hub_profile on public.user_profiles;
create trigger trg_auto_provision_staff_hub_profile
  before insert on public.user_profiles
  for each row
  execute function private.auto_provision_staff_hub_profile();

commit;;
