-- Durable manager activity audit trail for RTB OS.
create table if not exists public.manager_activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  business_unit_id uuid,
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  target_staff_id uuid,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists manager_activity_actor_idx on public.manager_activity_log(actor_user_id, occurred_at desc);
create index if not exists manager_activity_business_idx on public.manager_activity_log(business_unit_id, occurred_at desc);
create index if not exists manager_activity_target_idx on public.manager_activity_log(target_staff_id, occurred_at desc);

alter table public.manager_activity_log enable row level security;

drop policy if exists manager_activity_log_select on public.manager_activity_log;
create policy manager_activity_log_select on public.manager_activity_log
for select to authenticated
using (
  actor_user_id = auth.uid()
  or private.can_access_business_module(business_unit_id, 'operations', 'view')
);

drop policy if exists manager_activity_log_insert on public.manager_activity_log;
create policy manager_activity_log_insert on public.manager_activity_log
for insert to authenticated
with check (
  actor_user_id = auth.uid()
  and private.can_access_business_module(business_unit_id, 'operations', 'edit')
);

create or replace function private.record_manager_activity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_business uuid;
  v_target uuid;
  v_action text;
begin
  v_actor := coalesce(
    case when tg_table_name = 'staff_warnings' then new.issued_by else null end,
    case when tg_table_name in ('staff_tasks','hub_tasks','staff_operations_requests','staff_announcements','hub_announcements') then new.created_by else null end,
    case when tg_table_name = 'staff_shift_records' then new.manager_approved_by else null end,
    case when tg_table_name = 'operation_checklist_runs' then new.manager_approved_by else null end,
    auth.uid()
  );
  v_business := case when to_jsonb(new) ? 'business_unit_id' then (to_jsonb(new)->>'business_unit_id')::uuid else null end;
  v_target := case when to_jsonb(new) ? 'staff_id' then (to_jsonb(new)->>'staff_id')::uuid else null end;
  v_action := case
    when tg_table_name = 'staff_warnings' then 'warning_issued'
    when tg_table_name = 'staff_tasks' then 'staff_task_created'
    when tg_table_name = 'hub_tasks' then 'hub_task_created'
    when tg_table_name = 'staff_operations_requests' then 'operations_request_created'
    when tg_table_name in ('staff_announcements','hub_announcements') then 'announcement_created'
    when tg_table_name = 'staff_shift_records' then 'shift_approved'
    when tg_table_name = 'operation_checklist_runs' then 'checklist_approved'
    else tg_table_name || '_' || lower(tg_op)
  end;

  if v_actor is not null then
    insert into public.manager_activity_log(actor_user_id,business_unit_id,action_type,entity_type,entity_id,target_staff_id,summary,metadata)
    values (v_actor,v_business,v_action,tg_table_name,new.id,v_target,coalesce(to_jsonb(new)->>'title',to_jsonb(new)->>'note',v_action),jsonb_build_object('source','database_trigger'));
  end if;
  return new;
end;
$$;

-- Log only actions with a meaningful manager actor. Existing business tables remain the source of truth.
drop trigger if exists audit_staff_warnings_manager on public.staff_warnings;
create trigger audit_staff_warnings_manager after insert on public.staff_warnings for each row execute function private.record_manager_activity();
drop trigger if exists audit_staff_tasks_manager on public.staff_tasks;
create trigger audit_staff_tasks_manager after insert on public.staff_tasks for each row execute function private.record_manager_activity();
drop trigger if exists audit_hub_tasks_manager on public.hub_tasks;
create trigger audit_hub_tasks_manager after insert on public.hub_tasks for each row execute function private.record_manager_activity();
drop trigger if exists audit_staff_ops_requests_manager on public.staff_operations_requests;
create trigger audit_staff_ops_requests_manager after insert on public.staff_operations_requests for each row execute function private.record_manager_activity();
drop trigger if exists audit_staff_announcements_manager on public.staff_announcements;
create trigger audit_staff_announcements_manager after insert on public.staff_announcements for each row execute function private.record_manager_activity();
drop trigger if exists audit_hub_announcements_manager on public.hub_announcements;
create trigger audit_hub_announcements_manager after insert on public.hub_announcements for each row execute function private.record_manager_activity();

drop trigger if exists audit_shift_approval_manager on public.staff_shift_records;
create trigger audit_shift_approval_manager after update of manager_approved_by on public.staff_shift_records
for each row when (new.manager_approved_by is not null and old.manager_approved_by is distinct from new.manager_approved_by)
execute function private.record_manager_activity();

drop trigger if exists audit_checklist_approval_manager on public.operation_checklist_runs;
create trigger audit_checklist_approval_manager after update of manager_approved_by on public.operation_checklist_runs
for each row when (new.manager_approved_by is not null and old.manager_approved_by is distinct from new.manager_approved_by)
execute function private.record_manager_activity();
