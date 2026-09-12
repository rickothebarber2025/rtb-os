-- Stamp management actors at the database boundary so audit history does not depend on each UI remembering actor fields.

create or replace function private.stamp_management_actor()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name in ('staff_tasks','hub_tasks','staff_operations_requests','staff_announcements','hub_announcements')
     and tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'staff_time_off_requests' and tg_op = 'UPDATE'
        and old.status is distinct from new.status and new.status in ('approved','denied') then
    new.decided_by := coalesce(new.decided_by, auth.uid());
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_staff_tasks_actor on public.staff_tasks;
create trigger stamp_staff_tasks_actor before insert on public.staff_tasks
for each row execute function private.stamp_management_actor();

drop trigger if exists stamp_hub_tasks_actor on public.hub_tasks;
create trigger stamp_hub_tasks_actor before insert on public.hub_tasks
for each row execute function private.stamp_management_actor();

drop trigger if exists stamp_staff_ops_requests_actor on public.staff_operations_requests;
create trigger stamp_staff_ops_requests_actor before insert on public.staff_operations_requests
for each row execute function private.stamp_management_actor();

drop trigger if exists stamp_staff_announcements_actor on public.staff_announcements;
create trigger stamp_staff_announcements_actor before insert on public.staff_announcements
for each row execute function private.stamp_management_actor();

drop trigger if exists stamp_hub_announcements_actor on public.hub_announcements;
create trigger stamp_hub_announcements_actor before insert on public.hub_announcements
for each row execute function private.stamp_management_actor();

drop trigger if exists stamp_time_off_decision_actor on public.staff_time_off_requests;
create trigger stamp_time_off_decision_actor before update of status on public.staff_time_off_requests
for each row execute function private.stamp_management_actor();

-- Use the persisted decision actor instead of session context in the audit trigger.
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
  if tg_table_name = 'staff_warnings' then
    if tg_op = 'INSERT' then v_actor := new.issued_by; v_action := 'warning_issued';
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('resolved','void') then
      v_actor := new.resolved_by; v_action := case when new.status='resolved' then 'warning_resolved' else 'warning_voided' end;
    else return new; end if;
  elsif tg_table_name = 'staff_tasks' and tg_op='INSERT' then v_actor:=new.created_by; v_action:='staff_task_created';
  elsif tg_table_name = 'hub_tasks' and tg_op='INSERT' then v_actor:=new.created_by; v_action:='hub_task_created';
  elsif tg_table_name = 'staff_operations_requests' then
    if tg_op='INSERT' then v_actor:=new.created_by; v_action:='operations_request_created';
    elsif tg_op='UPDATE' and old.status is distinct from new.status then v_actor:=auth.uid(); v_action:='operations_request_status_changed';
    else return new; end if;
  elsif tg_table_name in ('staff_announcements','hub_announcements') and tg_op='INSERT' then v_actor:=new.created_by; v_action:='announcement_created';
  elsif tg_table_name='staff_shift_records' and tg_op='UPDATE' and new.manager_approved_by is not null and old.manager_approved_by is distinct from new.manager_approved_by then v_actor:=new.manager_approved_by; v_action:='shift_approved';
  elsif tg_table_name='operation_checklist_runs' and tg_op='UPDATE' and new.manager_approved_by is not null and old.manager_approved_by is distinct from new.manager_approved_by then v_actor:=new.manager_approved_by; v_action:='checklist_approved';
  elsif tg_table_name='staff_time_off_requests' and tg_op='UPDATE' and old.status is distinct from new.status and new.status in ('approved','denied') then
    v_actor:=new.decided_by; v_action:=case when new.status='approved' then 'time_off_approved' else 'time_off_denied' end;
  else return new; end if;

  if v_actor is null then return new; end if;
  v_business := case when v_row ? 'business_unit_id' and nullif(v_row->>'business_unit_id','') is not null then (v_row->>'business_unit_id')::uuid else null end;
  v_target := case when v_row ? 'staff_id' and nullif(v_row->>'staff_id','') is not null then (v_row->>'staff_id')::uuid else null end;
  v_summary := coalesce(nullif(v_row->>'title',''),nullif(v_row->>'note',''),nullif(v_row->>'reason',''),v_action);

  insert into public.manager_activity_log(actor_user_id,business_unit_id,action_type,entity_type,entity_id,target_staff_id,summary,metadata)
  values(v_actor,v_business,v_action,tg_table_name,new.id,v_target,v_summary,jsonb_build_object('source','database_trigger','operation',tg_op,'status',v_row->>'status','previous_status',v_old->>'status'))
  on conflict do nothing;
  return new;
end;
$$;
