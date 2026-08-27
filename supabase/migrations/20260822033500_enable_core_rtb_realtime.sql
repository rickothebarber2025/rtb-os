-- RTB OS relies on these high-value tables for live cross-module refresh.
-- Keep this migration idempotent so fresh and existing projects can apply it safely.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'user_profiles',
    'staff',
    'staff_tasks',
    'staff_time_off_requests',
    'staff_shift_records',
    'staff_operations_requests',
    'operation_checklist_runs',
    'owner_activity_events',
    'payroll_runs',
    'integration_connections',
    'talent_candidates'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null
      and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_table
      ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;
