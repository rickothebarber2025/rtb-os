create or replace function public.guard_role_template_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_template text := coalesce(new.permissions->>'role_template', '');
begin
  if v_template = 'operations_cleaning' then
    new.role := 'contractor';
    new.user_type := 'contractor';
    new.role_title := 'Operations Cleaning';
    new.permissions := jsonb_set(coalesce(new.permissions, '{}'::jsonb), '{role_title}', '"Operations Cleaning"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,operations}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,payroll}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,performance}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,appointments}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,roster}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,access}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,settings}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,booth_rent}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,dashboard}', '"none"'::jsonb, true);
    new.permissions := jsonb_set(new.permissions, '{modules,staff_hub}', '"view"'::jsonb, true);
  elsif v_template = 'operations_assistant' then
    new.role_title := 'Operations Assistant';
    new.permissions := jsonb_set(coalesce(new.permissions, '{}'::jsonb), '{role_title}', '"Operations Assistant"'::jsonb, true);
  elsif v_template = 'staff_portal' then
    new.role_title := 'Staff Portal';
    new.permissions := jsonb_set(coalesce(new.permissions, '{}'::jsonb), '{role_title}', '"Staff Portal"'::jsonb, true);
  end if;
  return new;
end;
$$;

drop trigger if exists guard_role_template_identity on public.user_profiles;
create trigger guard_role_template_identity
before insert or update of permissions, role, role_title, user_type
on public.user_profiles
for each row execute function public.guard_role_template_identity();

update public.user_profiles
set updated_at = now()
where active and permissions->>'role_template' in ('operations_cleaning','operations_assistant','staff_portal');
