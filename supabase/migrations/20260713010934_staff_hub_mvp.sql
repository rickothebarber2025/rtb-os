begin;

alter table public.staff
  add column if not exists photo_url text,
  add column if not exists services_offered jsonb not null default '[]'::jsonb,
  add column if not exists social_handle text,
  add column if not exists bio text,
  add column if not exists probation_end_date date;

create or replace function private.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select s.id
  from public.staff s
  join public.user_profiles up
    on lower(coalesce(up.email, '')) = lower(coalesce(s.email, ''))
  where up.id = (select auth.uid())
  order by s.active desc, s.created_at desc
  limit 1;
$function$;

create or replace function private.staff_hub_business_admin(p_business_unit_id uuid, p_minimum text default 'edit')
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_business_unit_id is null then (
      private.permission_rank(private.module_permission('operations')) >= private.permission_rank(p_minimum)
      or private.permission_rank(private.module_permission('roster')) >= private.permission_rank(p_minimum)
      or private.permission_rank(private.module_permission('access')) >= private.permission_rank(p_minimum)
    )
    else (
      private.can_access_business_module(p_business_unit_id, 'operations', p_minimum)
      or private.can_access_business_module(p_business_unit_id, 'roster', p_minimum)
      or private.can_access_business_module(p_business_unit_id, 'access', p_minimum)
    )
  end;
$function$;

create or replace function private.staff_hub_business_view(p_business_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_business_unit_id is null then private.has_any_module_view()
    else private.can_access_business_unit(p_business_unit_id)
  end;
$function$;

grant execute on function private.current_staff_id() to authenticated;
grant execute on function private.staff_hub_business_admin(uuid, text) to authenticated;
grant execute on function private.staff_hub_business_view(uuid) to authenticated;

create table if not exists public.staff_announcements (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete set null,
  title text not null,
  body text not null,
  category text not null default 'reminder'
    check (category in ('policy', 'schedule', 'promotion', 'training', 'event', 'reminder')),
  pinned boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_announcement_reads (
  announcement_id uuid not null references public.staff_announcements(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, staff_id)
);

create table if not exists public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete set null,
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time,
  end_time time,
  unavailable boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  unique (staff_id, day_of_week)
);

create table if not exists public.staff_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete set null,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  admin_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.staff_tasks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete set null,
  title text not null,
  category text not null default 'general'
    check (category in ('cleaning', 'opening', 'closing', 'content', 'restocking', 'client_followup', 'general')),
  details text,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_newsletters (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete set null,
  week_start date not null,
  top_performer_id uuid references public.staff(id) on delete set null,
  top_performer_note text,
  weekly_goals text,
  reminders text,
  client_feedback text,
  new_services_promos text,
  improvements_needed text,
  published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_unit_id, week_start)
);

create table if not exists public.staff_content_submissions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid references public.business_units(id) on delete set null,
  media_url text,
  media_type text not null default 'idea' check (media_type in ('photo', 'video', 'idea')),
  caption text,
  content_type text not null default 'work' check (content_type in ('work', 'before_after', 'idea')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_announcements_business_idx on public.staff_announcements (business_unit_id, pinned desc, created_at desc);
create index if not exists staff_reads_staff_idx on public.staff_announcement_reads (staff_id);
create index if not exists staff_availability_staff_idx on public.staff_availability (staff_id);
create index if not exists staff_time_off_staff_status_idx on public.staff_time_off_requests (staff_id, status, start_date desc);
create index if not exists staff_tasks_staff_status_idx on public.staff_tasks (staff_id, status, due_date);
create index if not exists staff_newsletters_business_week_idx on public.staff_newsletters (business_unit_id, week_start desc);
create index if not exists staff_content_staff_status_idx on public.staff_content_submissions (staff_id, status, created_at desc);

alter table public.staff_announcements enable row level security;
alter table public.staff_announcement_reads enable row level security;
alter table public.staff_availability enable row level security;
alter table public.staff_time_off_requests enable row level security;
alter table public.staff_tasks enable row level security;
alter table public.staff_newsletters enable row level security;
alter table public.staff_content_submissions enable row level security;

grant select, insert, update, delete on public.staff_announcements to authenticated;
grant select, insert, update, delete on public.staff_announcement_reads to authenticated;
grant select, insert, update, delete on public.staff_availability to authenticated;
grant select, insert, update, delete on public.staff_time_off_requests to authenticated;
grant select, insert, update, delete on public.staff_tasks to authenticated;
grant select, insert, update, delete on public.staff_newsletters to authenticated;
grant select, insert, update, delete on public.staff_content_submissions to authenticated;

drop policy if exists staff_announcements_select on public.staff_announcements;
drop policy if exists staff_announcements_insert on public.staff_announcements;
drop policy if exists staff_announcements_update on public.staff_announcements;
drop policy if exists staff_announcements_delete on public.staff_announcements;
create policy staff_announcements_select on public.staff_announcements
for select to authenticated
using (private.staff_hub_business_view(business_unit_id));
create policy staff_announcements_insert on public.staff_announcements
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_announcements_update on public.staff_announcements
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_announcements_delete on public.staff_announcements
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists staff_reads_select on public.staff_announcement_reads;
drop policy if exists staff_reads_insert on public.staff_announcement_reads;
drop policy if exists staff_reads_update on public.staff_announcement_reads;
drop policy if exists staff_reads_delete on public.staff_announcement_reads;
create policy staff_reads_select on public.staff_announcement_reads
for select to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(null, 'view'));
create policy staff_reads_insert on public.staff_announcement_reads
for insert to authenticated
with check (staff_id = private.current_staff_id());
create policy staff_reads_update on public.staff_announcement_reads
for update to authenticated
using (staff_id = private.current_staff_id())
with check (staff_id = private.current_staff_id());
create policy staff_reads_delete on public.staff_announcement_reads
for delete to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(null, 'admin'));

drop policy if exists staff_availability_select on public.staff_availability;
drop policy if exists staff_availability_insert on public.staff_availability;
drop policy if exists staff_availability_update on public.staff_availability;
drop policy if exists staff_availability_delete on public.staff_availability;
create policy staff_availability_select on public.staff_availability
for select to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'view'));
create policy staff_availability_insert on public.staff_availability
for insert to authenticated
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_availability_update on public.staff_availability
for update to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_availability_delete on public.staff_availability
for delete to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists staff_time_off_select on public.staff_time_off_requests;
drop policy if exists staff_time_off_insert on public.staff_time_off_requests;
drop policy if exists staff_time_off_update on public.staff_time_off_requests;
drop policy if exists staff_time_off_delete on public.staff_time_off_requests;
create policy staff_time_off_select on public.staff_time_off_requests
for select to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'view'));
create policy staff_time_off_insert on public.staff_time_off_requests
for insert to authenticated
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_time_off_update on public.staff_time_off_requests
for update to authenticated
using (
  private.staff_hub_business_admin(business_unit_id, 'edit')
  or (staff_id = private.current_staff_id() and status = 'pending')
)
with check (
  private.staff_hub_business_admin(business_unit_id, 'edit')
  or (staff_id = private.current_staff_id() and status = 'pending')
);
create policy staff_time_off_delete on public.staff_time_off_requests
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists staff_tasks_select on public.staff_tasks;
drop policy if exists staff_tasks_insert on public.staff_tasks;
drop policy if exists staff_tasks_update on public.staff_tasks;
drop policy if exists staff_tasks_delete on public.staff_tasks;
create policy staff_tasks_select on public.staff_tasks
for select to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'view'));
create policy staff_tasks_insert on public.staff_tasks
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_tasks_update on public.staff_tasks
for update to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_tasks_delete on public.staff_tasks
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists staff_newsletters_select on public.staff_newsletters;
drop policy if exists staff_newsletters_insert on public.staff_newsletters;
drop policy if exists staff_newsletters_update on public.staff_newsletters;
drop policy if exists staff_newsletters_delete on public.staff_newsletters;
create policy staff_newsletters_select on public.staff_newsletters
for select to authenticated
using ((published and private.staff_hub_business_view(business_unit_id)) or private.staff_hub_business_admin(business_unit_id, 'view'));
create policy staff_newsletters_insert on public.staff_newsletters
for insert to authenticated
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_newsletters_update on public.staff_newsletters
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_newsletters_delete on public.staff_newsletters
for delete to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'admin'));

drop policy if exists staff_content_select on public.staff_content_submissions;
drop policy if exists staff_content_insert on public.staff_content_submissions;
drop policy if exists staff_content_update on public.staff_content_submissions;
drop policy if exists staff_content_delete on public.staff_content_submissions;
create policy staff_content_select on public.staff_content_submissions
for select to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'view'));
create policy staff_content_insert on public.staff_content_submissions
for insert to authenticated
with check (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_content_update on public.staff_content_submissions
for update to authenticated
using (private.staff_hub_business_admin(business_unit_id, 'edit'))
with check (private.staff_hub_business_admin(business_unit_id, 'edit'));
create policy staff_content_delete on public.staff_content_submissions
for delete to authenticated
using (staff_id = private.current_staff_id() or private.staff_hub_business_admin(business_unit_id, 'admin'));

commit;
