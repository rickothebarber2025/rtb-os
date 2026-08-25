create or replace function private.staff_notification_tab(p_type text)
returns text
language sql
immutable
set search_path = public, private
as $$
  select case
    when lower(coalesce(p_type,'')) ~ '(clean|opening|closing|shift|attendance|task|inventory|maintenance|shop_status)' then 'daily'
    when lower(coalesce(p_type,'')) ~ '(announcement|policy|update)' then 'home'
    when lower(coalesce(p_type,'')) ~ '(performance|coaching|goal)' then 'performance'
    else 'daily'
  end;
$$;

create or replace function private.enqueue_staff_operation_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_user_id uuid;
  v_tab text;
begin
  select up.id
    into v_user_id
  from public.staff s
  join public.user_profiles up on lower(up.email) = lower(s.email)
  where s.id = new.staff_id
    and up.active = true
  order by case when up.business_unit_id is not distinct from new.business_unit_id then 0 else 1 end,
           up.updated_at desc
  limit 1;

  if v_user_id is null then
    return new;
  end if;

  v_tab := private.staff_notification_tab(new.notification_type);

  insert into public.push_notification_queue(
    user_id,title,body,data,source_table,source_id,status,attempts,attempt_count,next_attempt_at,created_at,updated_at
  ) values (
    v_user_id,
    new.title,
    coalesce(new.body,''),
    jsonb_build_object(
      'route','staff-hub',
      'page','staff-hub',
      'tab',v_tab,
      'staff_hub_tab',v_tab,
      'notification_type',new.notification_type,
      'business_unit_id',new.business_unit_id,
      'staff_notification_id',new.id
    ),
    'staff_operation_notifications',
    new.id,
    'pending',0,0,now(),now(),now()
  )
  on conflict (user_id, source_table, source_id, title)
    where source_id is not null
  do nothing;

  return new;
end;
$$;

drop trigger if exists enqueue_staff_operation_notification_push on public.staff_operation_notifications;
create trigger enqueue_staff_operation_notification_push
after insert on public.staff_operation_notifications
for each row execute function private.enqueue_staff_operation_notification_push();

create or replace function private.notify_staff_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.staff_operation_notifications(staff_id,business_unit_id,notification_type,title,body,idempotency_key)
    values (
      new.staff_id,new.business_unit_id,'task_assigned','New task assigned',
      new.title || case when new.due_date is not null then ' · Due ' || to_char(new.due_date,'Mon DD') else '' end,
      'task:' || new.id::text || ':assigned'
    ) on conflict (idempotency_key) do nothing;
  elsif tg_op = 'UPDATE'
    and old.status is distinct from new.status
    and new.status in ('pending','in_progress')
    and old.status not in ('pending','in_progress') then
    insert into public.staff_operation_notifications(staff_id,business_unit_id,notification_type,title,body,idempotency_key)
    values (
      new.staff_id,new.business_unit_id,'task_reopened','Task needs attention again',new.title,
      'task:' || new.id::text || ':reopened:' || coalesce(new.updated_at::text,now()::text)
    ) on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_staff_task_assignment on public.staff_tasks;
create trigger notify_staff_task_assignment
after insert or update on public.staff_tasks
for each row execute function private.notify_staff_task_assignment();

create or replace function private.notify_staff_announcement()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.staff_operation_notifications(staff_id,business_unit_id,notification_type,title,body,idempotency_key)
  select
    s.id,
    coalesce(new.business_unit_id,s.business_unit_id),
    'announcement',new.title,new.body,
    'announcement:' || new.id::text || ':staff:' || s.id::text
  from public.staff s
  where s.active = true
    and s.email is not null
    and (new.business_unit_id is null or s.business_unit_id is not distinct from new.business_unit_id)
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists notify_staff_announcement on public.staff_announcements;
create trigger notify_staff_announcement
after insert on public.staff_announcements
for each row execute function private.notify_staff_announcement();

create or replace function private.notify_staff_shop_status()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_business_name text;
begin
  select name into v_business_name from public.business_units where id = new.business_unit_id;

  insert into public.staff_operation_notifications(staff_id,business_unit_id,notification_type,title,body,idempotency_key)
  select
    s.id,new.business_unit_id,'shop_status',
    coalesce(v_business_name,'Shop') || ' is ' || initcap(new.status),
    coalesce(new.note, case when lower(new.status) = 'open' then 'The shop has been opened.' when lower(new.status) = 'closed' then 'The shop has been closed.' else 'Shop status changed.' end),
    'shop-status:' || new.id::text || ':staff:' || s.id::text
  from public.staff s
  where s.active = true
    and s.email is not null
    and s.business_unit_id is not distinct from new.business_unit_id
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists notify_staff_shop_status on public.shop_status_events;
create trigger notify_staff_shop_status
after insert on public.shop_status_events
for each row execute function private.notify_staff_shop_status();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='staff_operation_notifications'
  ) then
    alter publication supabase_realtime add table public.staff_operation_notifications;
  end if;
end $$;
