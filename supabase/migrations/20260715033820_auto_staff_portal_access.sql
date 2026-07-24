begin;

-- Active staff users should never get stuck with a blank Custom Role after an invite.
-- This keeps owner/admin access untouched and only upgrades staff-labelled profiles
-- that currently have no usable module permission into the Staff Portal template.
with staff_without_access as (
  select
    up.id,
    up.business_unit_id,
    case
      when jsonb_typeof(up.permissions -> 'business_unit_ids') = 'array'
        and jsonb_array_length(up.permissions -> 'business_unit_ids') > 0
        then up.permissions -> 'business_unit_ids'
      when up.business_unit_id is not null
        then jsonb_build_array(up.business_unit_id::text)
      else '[]'::jsonb
    end as business_unit_ids
  from public.user_profiles up
  where lower(coalesce(up.email, '')) <> 'rickothebarber@gmail.com'
    and lower(coalesce(up.role, '')) = 'staff'
    and (
      up.permissions is null
      or not exists (
        select 1
        from jsonb_each_text(
          case
            when jsonb_typeof(up.permissions -> 'modules') = 'object'
              then up.permissions -> 'modules'
            when jsonb_typeof(up.permissions) = 'object'
              then up.permissions
            else '{}'::jsonb
          end
        ) as module_access(module_id, permission_level)
        where lower(module_access.permission_level) in ('view', 'edit', 'admin')
      )
    )
)
update public.user_profiles up
set
  expectations = 'Use Staff Hub to review your own profile, role expectations, and assigned business.',
  permissions = jsonb_build_object(
    'business_scope', 'selected',
    'business_unit_ids', staff_without_access.business_unit_ids,
    'expectations', 'Use Staff Hub to review your own profile, role expectations, and assigned business.',
    'modules', jsonb_build_object(
      'dashboard', 'view',
      'roster', 'view',
      'payroll', 'none',
      'performance', 'none',
      'appointments', 'none',
      'booth_rent', 'none',
      'operations', 'none',
      'access', 'none',
      'settings', 'none'
    ),
    'responsibilities', jsonb_build_array(
      'Review your Staff Hub updates',
      'Keep your staff profile details accurate',
      'Check your assigned business and role expectations',
      'Report schedule, profile, or access issues to management'
    ),
    'restrictions', jsonb_build_array(
      'No payroll editing.',
      'No access management.',
      'No business settings changes.',
      'No deleting or changing other staff records.'
    ),
    'role_description', 'Basic staff login for Staff Hub, My Role, and read-only roster context.',
    'role_template', 'staff_portal',
    'role_title', 'Staff Portal'
  ),
  responsibilities = jsonb_build_array(
    'Review your Staff Hub updates',
    'Keep your staff profile details accurate',
    'Check your assigned business and role expectations',
    'Report schedule, profile, or access issues to management'
  ),
  restrictions = jsonb_build_array(
    'No payroll editing.',
    'No access management.',
    'No business settings changes.',
    'No deleting or changing other staff records.'
  ),
  role_description = 'Basic staff login for Staff Hub, My Role, and read-only roster context.',
  role_title = 'Staff Portal',
  updated_at = now()
from staff_without_access
where up.id = staff_without_access.id;

commit;;
