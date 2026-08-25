create table if not exists public.staff_warnings (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  level smallint not null default 1 check (level between 1 and 3),
  category text not null default 'general' check (category in ('attendance','performance','conduct','policy','cash','cleaning','client','general')),
  title text not null,
  details text,
  status text not null default 'active' check (status in ('active','resolved','void')),
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '90 days'),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_warnings_staff_id_idx on public.staff_warnings(staff_id);
create index if not exists staff_warnings_business_unit_id_idx on public.staff_warnings(business_unit_id);
create index if not exists staff_warnings_status_expires_idx on public.staff_warnings(status, expires_at);

alter table public.staff_warnings enable row level security;

drop policy if exists staff_warnings_select on public.staff_warnings;
create policy staff_warnings_select on public.staff_warnings
for select to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'view'));

drop policy if exists staff_warnings_insert on public.staff_warnings;
create policy staff_warnings_insert on public.staff_warnings
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

drop policy if exists staff_warnings_update on public.staff_warnings;
create policy staff_warnings_update on public.staff_warnings
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));

drop policy if exists staff_warnings_delete on public.staff_warnings;
create policy staff_warnings_delete on public.staff_warnings
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

create or replace function public.acknowledge_my_staff_warning(p_warning_id uuid)
returns public.staff_warnings
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_staff_id uuid := private.current_staff_id();
  v_row public.staff_warnings;
begin
  if auth.uid() is null or v_staff_id is null then raise exception 'Your login is not linked to a staff profile.'; end if;
  update public.staff_warnings
  set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()), updated_at = now()
  where id = p_warning_id and staff_id = v_staff_id
  returning * into v_row;
  if v_row.id is null then raise exception 'Warning not found for this staff profile.'; end if;
  return v_row;
end;
$$;
revoke all on function public.acknowledge_my_staff_warning(uuid) from public;
grant execute on function public.acknowledge_my_staff_warning(uuid) to authenticated;

create or replace function private.staff_warning_defaults()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.issued_by := coalesce(new.issued_by, auth.uid());
    new.issued_at := coalesce(new.issued_at, now());
    new.expires_at := coalesce(new.expires_at, new.issued_at + interval '90 days');
  end if;
  if new.status in ('resolved','void') and old.status is distinct from new.status then
    new.resolved_at := coalesce(new.resolved_at, now());
    new.resolved_by := coalesce(new.resolved_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists staff_warnings_defaults on public.staff_warnings;
create trigger staff_warnings_defaults before insert or update on public.staff_warnings for each row execute function private.staff_warning_defaults();

create or replace function private.notify_staff_warning()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op = 'INSERT' then
    insert into public.staff_operation_notifications(staff_id,business_unit_id,notification_type,title,body,idempotency_key)
    values (new.staff_id,new.business_unit_id,'warning',case new.level when 3 then 'Final warning issued' when 2 then 'Written warning issued' else 'Staff warning issued' end,coalesce(new.details,new.title),'staff-warning:' || new.id::text)
    on conflict (idempotency_key) do nothing;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('resolved','void') then
    insert into public.staff_operation_notifications(staff_id,business_unit_id,notification_type,title,body,idempotency_key)
    values (new.staff_id,new.business_unit_id,'warning_update',case when new.status='resolved' then 'Warning resolved' else 'Warning voided' end,coalesce(new.resolution_note,new.title),'staff-warning:' || new.id::text || ':' || new.status)
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_warnings_notify on public.staff_warnings;
create trigger staff_warnings_notify after insert or update on public.staff_warnings for each row execute function private.notify_staff_warning();

alter table public.staff_time_off_requests
  add column if not exists notice_hours integer,
  add column if not exists meets_notice_policy boolean not null default true;

create or replace function private.enforce_staff_time_off_notice()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_start timestamptz;
  v_hours integer;
  v_is_self boolean;
  v_is_manager boolean;
begin
  v_start := (new.start_date::timestamp at time zone 'America/Toronto');
  v_hours := floor(extract(epoch from (v_start - now())) / 3600);
  new.notice_hours := v_hours;
  new.meets_notice_policy := v_hours >= 48;
  new.updated_at := now();
  v_is_self := new.staff_id = private.current_staff_id();
  v_is_manager := private.staff_hub_business_admin(new.business_unit_id, 'edit');
  if new.status = 'pending' and v_is_self and not v_is_manager and not new.meets_notice_policy
     and (tg_op = 'INSERT' or old.start_date is distinct from new.start_date) then
    raise exception 'Time-off requests require at least 48 hours notice. If this is an emergency, contact management directly.';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_staff_time_off_notice on public.staff_time_off_requests;
create trigger enforce_staff_time_off_notice before insert or update of start_date,status on public.staff_time_off_requests for each row execute function private.enforce_staff_time_off_notice();

create or replace function private.notify_time_off_decision()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if old.status is distinct from new.status and new.status in ('approved','denied') then
    insert into public.staff_operation_notifications(staff_id,business_unit_id,notification_type,title,body,idempotency_key)
    values (new.staff_id,new.business_unit_id,'time_off_decision',case when new.status='approved' then 'Time off approved' else 'Time off not approved' end,
      case when new.admin_note is not null and length(trim(new.admin_note)) > 0 then new.admin_note when new.status='approved' then 'Your time-off request has been approved.' else 'Your time-off request was declined. Check with management if you need clarification.' end,
      'time-off:' || new.id::text || ':' || new.status)
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_time_off_decision on public.staff_time_off_requests;
create trigger notify_time_off_decision after update of status on public.staff_time_off_requests for each row execute function private.notify_time_off_decision();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='staff_warnings') then
    alter publication supabase_realtime add table public.staff_warnings;
  end if;
end $$;