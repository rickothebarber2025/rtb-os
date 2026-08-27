do $$
declare
  t text;
  tables text[] := array[
    'business_units',
    'integration_connections',
    'operation_checklist_runs',
    'owner_activity_events',
    'payroll_runs',
    'staff',
    'staff_announcements',
    'staff_operations_requests',
    'staff_shift_records',
    'staff_tasks',
    'staff_time_off_requests',
    'talent_candidates',
    'user_profiles'
  ];
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = t
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
