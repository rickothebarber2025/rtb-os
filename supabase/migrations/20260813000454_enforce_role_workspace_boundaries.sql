-- Keep Operations Cleaning contractors inside the role-specific Staff Hub workspace.
update public.user_profiles
set permissions = jsonb_set(
      coalesce(permissions, '{}'::jsonb),
      '{modules,operations}',
      '"none"'::jsonb,
      true
    ),
    updated_at = now()
where active
  and permissions->>'role_template' = 'operations_cleaning';

-- Repair visible title drift for Operations Assistant profiles.
update public.user_profiles
set role_title = 'Operations Assistant',
    permissions = jsonb_set(
      coalesce(permissions, '{}'::jsonb),
      '{role_title}',
      '"Operations Assistant"'::jsonb,
      true
    ),
    updated_at = now()
where active
  and permissions->>'role_template' = 'operations_assistant'
  and coalesce(role_title, '') <> 'Operations Assistant';
