-- Production-only historical objects may be absent from clean preview databases.
-- Add each operational index only when its table and target column are present.
do $indexes$
declare
  index_spec record;
begin
  for index_spec in
    select *
    from (
      values
        ('app_client_errors_business_unit_id_idx','app_client_errors','business_unit_id'),
        ('app_client_errors_staff_id_idx','app_client_errors','staff_id'),
        ('owner_activity_events_actor_staff_id_idx','owner_activity_events','actor_staff_id'),
        ('operation_checklist_runs_staff_id_idx','operation_checklist_runs','staff_id'),
        ('staff_operations_requests_assigned_to_idx','staff_operations_requests','assigned_to'),
        ('staff_operations_requests_created_by_idx','staff_operations_requests','created_by'),
        ('integration_credentials_business_unit_id_idx','integration_credentials','business_unit_id'),
        ('rtb_automation_log_business_unit_id_idx','rtb_automation_log','business_unit_id'),
        ('rtb_automation_log_staff_id_idx','rtb_automation_log','staff_id'),
        ('rtb_automation_log_created_task_id_idx','rtb_automation_log','created_task_id'),
        ('talent_candidates_staff_id_idx','talent_candidates','staff_id')
    ) as specs(index_name, table_name, column_name)
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = index_spec.table_name
        and column_name = index_spec.column_name
    ) then
      execute format(
        'create index if not exists %I on public.%I(%I)',
        index_spec.index_name,
        index_spec.table_name,
        index_spec.column_name
      );
    end if;
  end loop;
end;
$indexes$;
