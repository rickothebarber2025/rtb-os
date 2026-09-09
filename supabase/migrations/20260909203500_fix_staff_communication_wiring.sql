begin;

-- Make staff announcements behave like real team communication:
-- 1) every announcement/update reaches eligible staff in-app + push,
-- 2) owner gets manager-posted updates,
-- 3) staff and management can reply in a shared thread.

create table if not exists public.staff_announcement_messages (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.staff_announcements(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  sender_kind text not null check (sender_kind in ('staff','manager')),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists staff_announcement_messages_thread_idx
  on public.staff_announcement_messages (announcement_id, staff_id, created_at);

alter table public.staff_announcement_messages enable row level security;
grant select, insert on public.staff_announcement_messages to authenticated;

drop policy if exists staff_announcement_messages_select on public.staff_announcement_messages;
create policy staff_announcement_messages_select
on public.staff_announcement_messages
for select to authenticated
using (
  staff_id = private.current_staff_id()
  or exists (
    select 1
    from public.staff_announcements a
    where a.id = announcement_id
      and private.staff_hub_business_admin(a.business_unit_id, 'view')
  )
  or private.is_app_admin()
);

drop policy if exists staff_announcement_messages_insert on public.staff_announcement_messages;
create policy staff_announcement_messages_insert
on public.staff_announcement_messages
for insert to authenticated
with check (
  (
    sender_kind = 'staff'
    and staff_id = private.current_staff_id()
    and sender_user_id = auth.uid()
  )
  or (
    sender_kind = 'manager'
    and sender_user_id = auth.uid()
    and exists (
      select 1
      from public.staff_announcements a
      where a.id = announcement_id
        and private.staff_hub_business_admin(a.business_unit_id, 'edit')
    )
  )
  or private.is_app_admin()
);

create or replace function private.notify_staff_announcement()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_version text;
  v_owner_id uuid;
  v_actor_name text;
  v_business_name text;
begin
  if tg_op = 'UPDATE' and not (
    old.title is distinct from new.title
    or old.body is distinct from new.body
    or old.category is distinct from new.category
    or old.pinned is distinct from new.pinned
  ) then
    return new;
  end if;

  v_version := case
    when tg_op = 'INSERT' then 'new'
    else to_char(coalesce(new.updated_at, now()), 'YYYYMMDDHH24MISSMS')
  end;

  insert into public.staff_operation_notifications(
    staff_id,business_unit_id,notification_type,title,body,idempotency_key
  )
  select
    s.id,
    coalesce(new.business_unit_id,s.business_unit_id),
    case when tg_op = 'INSERT' then 'announcement' else 'announcement_update' end,
    new.title,
    new.body,
    'announcement:' || new.id::text || ':' || v_version || ':staff:' || s.id::text
  from public.staff s
  where s.active = true
    and s.email is not null
    and (new.business_unit_id is null or s.business_unit_id is not distinct from new.business_unit_id)
  on conflict (idempotency_key) do nothing;

  select id into v_owner_id
  from public.user_profiles
  where active = true and lower(email) = 'rickothebarber@gmail.com'
  order by updated_at desc nulls last
  limit 1;

  if v_owner_id is not null and new.created_by is distinct from v_owner_id then
    select coalesce(nullif(trim(full_name),''), email, 'Manager')
      into v_actor_name
    from public.user_profiles
    where id = new.created_by;

    select name into v_business_name
    from public.business_units
    where id = new.business_unit_id;

    insert into public.owner_activity_events(
      business_unit_id,category,action,title,body,source_table,source_id,metadata
    ) values (
      new.business_unit_id,
      'staff',
      case when tg_op = 'INSERT' then 'manager_staff_announcement_posted' else 'manager_staff_announcement_updated' end,
      coalesce(v_actor_name,'Manager') || ' posted a staff update',
      new.title || case when nullif(trim(new.body),'') is not null then ' · ' || left(trim(new.body), 240) else '' end,
      'staff_announcements',
      new.id,
      jsonb_build_object(
        'priority','info',
        'page','staff-hub',
        'tab','home',
        'action_label','Open update',
        'business_name',coalesce(v_business_name,'Both businesses'),
        'announcement_id',new.id
      )
    );

    insert into public.push_notification_queue(
      user_id,title,body,data,source_table,source_id,status,attempts,attempt_count,next_attempt_at,created_at,updated_at
    ) values (
      v_owner_id,
      coalesce(v_actor_name,'Manager') || ' posted a staff update',
      new.title,
      jsonb_build_object(
        'route','staff-hub',
        'page','staff-hub',
        'tab','home',
        'staff_hub_tab','home',
        'business_unit_id',new.business_unit_id,
        'announcement_id',new.id
      ),
      'staff_announcements',
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

drop trigger if exists notify_staff_announcement on public.staff_announcements;
create trigger notify_staff_announcement
after insert or update on public.staff_announcements
for each row execute function private.notify_staff_announcement();

create or replace function private.notify_announcement_message()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_announcement public.staff_announcements;
  v_staff_name text;
  v_owner_id uuid;
begin
  select * into v_announcement
  from public.staff_announcements
  where id = new.announcement_id;

  select full_name into v_staff_name from public.staff where id = new.staff_id;

  if new.sender_kind = 'staff' then
    select id into v_owner_id
    from public.user_profiles
    where active = true and lower(email) = 'rickothebarber@gmail.com'
    order by updated_at desc nulls last
    limit 1;

    insert into public.owner_activity_events(
      business_unit_id,actor_staff_id,category,action,title,body,source_table,source_id,metadata
    ) values (
      v_announcement.business_unit_id,
      new.staff_id,
      'staff',
      'staff_replied_to_announcement',
      coalesce(v_staff_name,'Staff member') || ' replied to ' || v_announcement.title,
      left(new.body, 300),
      'staff_announcement_messages',
      new.id,
      jsonb_build_object(
        'priority','attention',
        'page','staff-hub',
        'tab','home',
        'action_label','Open conversation',
        'announcement_id',new.announcement_id,
        'staff_id',new.staff_id
      )
    );

    if v_owner_id is not null then
      insert into public.push_notification_queue(
        user_id,title,body,data,source_table,source_id,status,attempts,attempt_count,next_attempt_at,created_at,updated_at
      ) values (
        v_owner_id,
        coalesce(v_staff_name,'Staff member') || ' replied',
        left(new.body, 240),
        jsonb_build_object(
          'route','staff-hub','page','staff-hub','tab','home','staff_hub_tab','home',
          'announcement_id',new.announcement_id,'staff_id',new.staff_id
        ),
        'staff_announcement_messages',new.id,'pending',0,0,now(),now(),now()
      )
      on conflict (user_id, source_table, source_id, title)
        where source_id is not null
      do nothing;
    end if;
  else
    insert into public.staff_operation_notifications(
      staff_id,business_unit_id,notification_type,title,body,idempotency_key
    ) values (
      new.staff_id,
      v_announcement.business_unit_id,
      'announcement_reply',
      'Management replied · ' || v_announcement.title,
      left(new.body, 300),
      'announcement-reply:' || new.id::text
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_announcement_message on public.staff_announcement_messages;
create trigger notify_announcement_message
after insert on public.staff_announcement_messages
for each row execute function private.notify_announcement_message();

-- Re-deliver recent announcements that may have been posted while the old wiring was broken.
insert into public.staff_operation_notifications(
  staff_id,business_unit_id,notification_type,title,body,idempotency_key
)
select
  s.id,
  coalesce(a.business_unit_id,s.business_unit_id),
  'announcement',
  a.title,
  a.body,
  'announcement:' || a.id::text || ':recovery:staff:' || s.id::text
from public.staff_announcements a
join public.staff s
  on s.active = true
 and s.email is not null
 and (a.business_unit_id is null or s.business_unit_id is not distinct from a.business_unit_id)
where a.created_at >= now() - interval '7 days'
on conflict (idempotency_key) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='staff_announcement_messages'
  ) then
    alter publication supabase_realtime add table public.staff_announcement_messages;
  end if;
end $$;

commit;
