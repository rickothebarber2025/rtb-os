begin;

-- Staff requests are high-value owner events. They must appear in the owner feed
-- and reach the owner's registered iOS devices without relying on the owner
-- manually opening Staff Hub.

create or replace function private.rtb_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, private
as $$
  select id
  from public.user_profiles
  where active = true
    and lower(email) = 'rickothebarber@gmail.com'
  order by updated_at desc nulls last
  limit 1;
$$;

revoke all on function private.rtb_owner_user_id() from public;

create or replace function private.notify_owner_time_off_request()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_owner_id uuid;
  v_staff_name text;
  v_business_name text;
  v_title text;
  v_body text;
  v_priority text;
begin
  -- New requests and material changes to a pending request require owner attention.
  if tg_op = 'UPDATE' and not (
    old.start_date is distinct from new.start_date
    or old.end_date is distinct from new.end_date
    or old.reason is distinct from new.reason
    or old.status is distinct from new.status
  ) then
    return new;
  end if;

  -- Do not alert the owner when the owner is merely recording the final decision.
  if tg_op = 'UPDATE' and new.status in ('approved','denied','declined') then
    return new;
  end if;

  if new.status is distinct from 'pending' then
    return new;
  end if;

  select full_name into v_staff_name from public.staff where id = new.staff_id;
  select name into v_business_name from public.business_units where id = new.business_unit_id;
  v_owner_id := private.rtb_owner_user_id();

  v_title := coalesce(v_staff_name, 'Staff member') || ' requested time off';
  v_body := to_char(new.start_date, 'Mon DD') ||
    case when new.end_date is not null and new.end_date <> new.start_date then ' – ' || to_char(new.end_date, 'Mon DD') else '' end ||
    case when nullif(trim(coalesce(new.reason,'')), '') is not null then ' · ' || trim(new.reason) else '' end;
  v_priority := case when coalesce(new.notice_hours, 9999) < 72 then 'high' else 'attention' end;

  insert into public.owner_activity_events(
    business_unit_id,actor_staff_id,category,action,title,body,source_table,source_id,metadata
  ) values (
    new.business_unit_id,
    new.staff_id,
    'requests',
    'time_off_request_submitted',
    v_title,
    v_body,
    'staff_time_off_requests',
    new.id,
    jsonb_build_object(
      'priority', v_priority,
      'page', 'action-center',
      'tab', 'time_off',
      'action_label', 'Review time off',
      'business_name', v_business_name,
      'request_type', 'time_off'
    )
  );

  if v_owner_id is not null then
    insert into public.push_notification_queue(
      user_id,title,body,data,source_table,source_id,status,attempts,attempt_count,next_attempt_at,created_at,updated_at
    ) values (
      v_owner_id,
      v_title,
      v_body,
      jsonb_build_object(
        'route','action-center',
        'page','action-center',
        'tab','time_off',
        'business_unit_id',new.business_unit_id,
        'request_type','time_off',
        'request_id',new.id,
        'staff_id',new.staff_id
      ),
      'staff_time_off_requests',
      new.id,
      'pending',0,0,now(),now(),now()
    )
    on conflict (user_id, source_table, source_id, title)
      where source_id is not null
    do update set
      body = excluded.body,
      data = excluded.data,
      status = 'pending',
      next_attempt_at = now(),
      updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function private.notify_owner_time_off_request() from public;

drop trigger if exists notify_owner_time_off_request on public.staff_time_off_requests;
create trigger notify_owner_time_off_request
after insert or update on public.staff_time_off_requests
for each row execute function private.notify_owner_time_off_request();

create or replace function private.notify_owner_operations_request()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_owner_id uuid;
  v_staff_name text;
  v_business_name text;
  v_title text;
  v_body text;
  v_push_title text;
begin
  -- Only alert on creation or a meaningful edit while the request is still active.
  if tg_op = 'UPDATE' and not (
    old.title is distinct from new.title
    or old.details is distinct from new.details
    or old.priority is distinct from new.priority
    or old.request_type is distinct from new.request_type
    or old.category is distinct from new.category
  ) then
    return new;
  end if;

  if new.status in ('completed','received','denied') then
    return new;
  end if;

  select full_name into v_staff_name from public.staff where id = new.staff_id;
  select name into v_business_name from public.business_units where id = new.business_unit_id;
  v_owner_id := private.rtb_owner_user_id();

  v_title := coalesce(nullif(trim(new.title), ''), initcap(replace(new.request_type, '_', ' ')) || ' request');
  v_push_title := coalesce(v_staff_name, 'Staff member') || ' · ' || v_title;
  v_body := coalesce(nullif(trim(new.details), ''),
    initcap(replace(new.request_type, '_', ' ')) || ' request from ' || coalesce(v_staff_name, 'staff'));

  insert into public.owner_activity_events(
    business_unit_id,actor_staff_id,category,action,title,body,source_table,source_id,metadata
  ) values (
    new.business_unit_id,
    new.staff_id,
    'operations',
    'staff_operations_request_submitted',
    v_title,
    v_body,
    'staff_operations_requests',
    new.id,
    jsonb_build_object(
      'priority', case when new.priority in ('urgent','high') then new.priority else 'attention' end,
      'page', 'staff-hub',
      'tab', 'daily',
      'action_label', 'Review request',
      'business_name', v_business_name,
      'request_type', new.request_type,
      'category', new.category
    )
  );

  if v_owner_id is not null then
    insert into public.push_notification_queue(
      user_id,title,body,data,source_table,source_id,status,attempts,attempt_count,next_attempt_at,created_at,updated_at
    ) values (
      v_owner_id,
      v_push_title,
      v_body,
      jsonb_build_object(
        'route','staff-hub',
        'page','staff-hub',
        'tab','daily',
        'staff_hub_tab','daily',
        'business_unit_id',new.business_unit_id,
        'request_type',new.request_type,
        'request_id',new.id,
        'staff_id',new.staff_id,
        'priority',new.priority
      ),
      'staff_operations_requests',
      new.id,
      'pending',0,0,now(),now(),now()
    )
    on conflict (user_id, source_table, source_id, title)
      where source_id is not null
    do update set
      body = excluded.body,
      data = excluded.data,
      status = 'pending',
      next_attempt_at = now(),
      updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function private.notify_owner_operations_request() from public;

drop trigger if exists notify_owner_operations_request on public.staff_operations_requests;
create trigger notify_owner_operations_request
after insert or update on public.staff_operations_requests
for each row execute function private.notify_owner_operations_request();

commit;