-- Harden RTB OS manager activity auditing after lifecycle review.
-- Existing business tables remain authoritative. This log records persisted management actions only.

create or replace function private.record_manager_activity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_actor uuid;
  v_business uuid;
  v_target uuid;
  v_action text;
  v_summary text;
begin
  -- Determine only meaningful persisted management actions. Do not manufacture activity.
  if tg_table_name = 'staff_warnings' then
    if tg_op = 'INSERT' then
      v_actor := new.issued_by;
      v_action := 'warning_issued';
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('resolved','void') then
      v_actor := new.resolved_by;
      v_action := case when new.status = 'resolved' then 'warning_resolved' else 'warning_voided' end;
    else
      return new;
    end if;
  elsif tg_table_name = 'staff_tasks' and tg_op = 'INSERT' then
    v_actor := new.created_by;
    v_action := 'staff_task_created';
  elsif tg_table_name = 'hub_tasks' and tg_op = 'INSERT' then
    v_actor := new.created_by;
    v_action := 'hub_task_created';
  elsif tg_table_name = 'staff_operations_requests' then
    if tg_op = 'INSERT' then
      v_actor := new.created_by;
      v_action := 'operations_request_created';
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
      v_actor := auth.uid();
      v_action := 'operations_request_status_changed';
    else
      return new;
    end if;
  elsif tg_table_name in ('staff_announcements','hub_announcements') and tg_op = 'INSERT' then
    v_actor := new.created_by;
    v_action := 'announcement_created';
  elsif tg_table_name = 'staff_shift_records' and tg_op = 'UPDATE'
        and new.manager_approved_by is not null
        and old.manager_approved_by is distinct from new.manager_approved_by then
    v_actor := new.manager_approved_by;
    v_action := 'shift_approved';
  elsif tg_table_name = 'operation_checklist_runs' and tg_op = 'UPDATE'
        and new.manager_approved_by is not null
        and old.manager_approved_by is distinct from new.manager_approved_by then
    v_actor := new.manager_approved_by;
    v_action := 'checklist_approved';
  elsif tg_table_name = 'staff_time_off_requests' and tg_op = 'UPDATE'
        and old.status is distinct from new.status and new.status in ('approved','denied') then
    v_actor := auth.uid();
    v_action := case when new.status = 'approved' then 'time_off_approved' else 'time_off_denied' end;
  else
    return new;
  end if;

  if v_actor is null then
    return new;
  end if;

  v_business := case when v_row ? 'business_unit_id' and nullif(v_row->>'business_unit_id','') is not null
    then (v_row->>'business_unit_id')::uuid else null end;
  v_target := case when v_row ? 'staff_id' and nullif(v_row->>'staff_id','') is not null
    then (v_row->>'staff_id')::uuid else null end;
  v_summary := coalesce(nullif(v_row->>'title',''), nullif(v_row->>'note',''), nullif(v_row->>'reason',''), v_action);

  insert into public.manager_activity_log(
    actor_user_id,business_unit_id,action_type,entity_type,entity_id,target_staff_id,summary,metadata
  ) values (
    v_actor,v_business,v_action,tg_table_name,new.id,v_target,v_summary,
    jsonb_build_object('source','database_trigger','operation',tg_op,'status',v_row->>'status','previous_status',v_old->>'status')
  );
  return new;
end;
$$;

-- Rebuild triggers so inserts and meaningful state transitions are captured consistently.
drop trigger if exists audit_staff_warnings_manager on public.staff_warnings;
create trigger audit_staff_warnings_manager
after insert or update on public.staff_warnings
for each row execute function private.record_manager_activity();

drop trigger if exists audit_staff_tasks_manager on public.staff_tasks;
create trigger audit_staff_tasks_manager after insert on public.staff_tasks
for each row execute function private.record_manager_activity();

drop trigger if exists audit_hub_tasks_manager on public.hub_tasks;
create trigger audit_hub_tasks_manager after insert on public.hub_tasks
for each row execute function private.record_manager_activity();

drop trigger if exists audit_staff_ops_requests_manager on public.staff_operations_requests;
create trigger audit_staff_ops_requests_manager after insert or update of status on public.staff_operations_requests
for each row execute function private.record_manager_activity();

drop trigger if exists audit_staff_announcements_manager on public.staff_announcements;
create trigger audit_staff_announcements_manager after insert on public.staff_announcements
for each row execute function private.record_manager_activity();

drop trigger if exists audit_hub_announcements_manager on public.hub_announcements;
create trigger audit_hub_announcements_manager after insert on public.hub_announcements
for each row execute function private.record_manager_activity();

drop trigger if exists audit_shift_approval_manager on public.staff_shift_records;
create trigger audit_shift_approval_manager after update of manager_approved_by on public.staff_shift_records
for each row execute function private.record_manager_activity();

drop trigger if exists audit_checklist_approval_manager on public.operation_checklist_runs;
create trigger audit_checklist_approval_manager after update of manager_approved_by on public.operation_checklist_runs
for each row execute function private.record_manager_activity();

drop trigger if exists audit_time_off_manager on public.staff_time_off_requests;
create trigger audit_time_off_manager after update of status on public.staff_time_off_requests
for each row execute function private.record_manager_activity();

-- Prevent duplicate audit rows if an idempotent client retry or trigger replay occurs.
create unique index if not exists manager_activity_unique_persisted_action_idx
on public.manager_activity_log(actor_user_id, action_type, entity_type, entity_id)
where entity_id is not null;
