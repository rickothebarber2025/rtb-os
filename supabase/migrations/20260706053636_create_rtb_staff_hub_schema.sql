-- ============================================================
-- RTB STAFF HUB : DATABASE SCHEMA
-- All tables are prefixed hub_ so nothing collides with existing tables.
-- ============================================================

-- ---------- 1. BUSINESSES ----------
create table if not exists hub_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz default now()
);

insert into hub_businesses (name) values ('RTB Lounge'), ('RTB Beauty Lounge')
on conflict (name) do nothing;

-- ---------- 2. STAFF PROFILES ----------
create table if not exists hub_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text unique not null,
  full_name text not null,
  role text not null default 'staff' check (role in ('admin','staff')),
  job_title text,
  business_id uuid references hub_businesses(id),
  photo_url text,
  start_date date,
  probation_end_date date,
  commission_level text default 'Probation 50/50'
    check (commission_level in ('Probation 50/50','Performance Review 55/45','Standard 60/40','Growth 65/35','Elite 70/30','Booth Rent 100%')),
  commission_rate numeric(4,2) default 0.50,
  services_offered text[],
  social_handle text,
  bio text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Link an auth signup to a pre-created profile by matching email
create or replace function hub_link_profile()
returns trigger language plpgsql security definer as $$
begin
  update hub_staff_profiles
     set auth_user_id = new.id
   where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;

drop trigger if exists hub_link_profile_trg on auth.users;
create trigger hub_link_profile_trg
after insert on auth.users
for each row execute function hub_link_profile();

-- Admin check helper (security definer avoids recursive RLS)
create or replace function hub_is_admin()
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from hub_staff_profiles
    where auth_user_id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function hub_my_profile_id()
returns uuid language sql security definer stable as $$
  select id from hub_staff_profiles where auth_user_id = auth.uid();
$$;

-- ---------- 3. ANNOUNCEMENTS ----------
create table if not exists hub_announcements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references hub_businesses(id),
  title text not null,
  body text not null,
  category text not null default 'reminder'
    check (category in ('policy','schedule','promotion','training','event','reminder')),
  pinned boolean default false,
  created_by uuid references hub_staff_profiles(id),
  created_at timestamptz default now()
);

create table if not exists hub_announcement_reads (
  announcement_id uuid references hub_announcements(id) on delete cascade,
  staff_id uuid references hub_staff_profiles(id) on delete cascade,
  read_at timestamptz default now(),
  primary key (announcement_id, staff_id)
);

-- ---------- 4. INCOME ----------
create table if not exists hub_income_records (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references hub_staff_profiles(id) on delete cascade,
  week_start date not null,
  net_sales numeric(10,2) default 0,
  tips numeric(10,2) default 0,
  commission_rate numeric(4,2) not null,
  deductions numeric(10,2) default 0,
  deduction_note text,
  estimated_payout numeric(10,2) generated always as
    (round(net_sales * commission_rate + tips - deductions, 2)) stored,
  is_paid boolean default false,
  paid_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  unique (staff_id, week_start)
);

-- ---------- 5. PERFORMANCE ----------
create table if not exists hub_performance_records (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references hub_staff_profiles(id) on delete cascade,
  week_start date not null,
  net_sales numeric(10,2) default 0,
  client_count int default 0,
  reviews_count int default 0,
  avg_review numeric(3,2),
  no_shows int default 0,
  late_count int default 0,
  attendance_note text,
  goal_sales numeric(10,2),
  is_staff_of_week boolean default false,
  is_staff_of_month boolean default false,
  admin_note text,
  created_at timestamptz default now(),
  unique (staff_id, week_start)
);

-- ---------- 6. SCHEDULE & TIME OFF ----------
create table if not exists hub_availability (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references hub_staff_profiles(id) on delete cascade,
  day_of_week int not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  updated_at timestamptz default now(),
  unique (staff_id, day_of_week)
);

create table if not exists hub_time_off_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references hub_staff_profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  admin_note text,
  decided_at timestamptz,
  created_at timestamptz default now()
);

-- ---------- 7. TASKS ----------
create table if not exists hub_tasks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references hub_staff_profiles(id) on delete cascade,
  title text not null,
  category text default 'general'
    check (category in ('cleaning','opening','closing','content','restocking','client_followup','general')),
  details text,
  due_date date,
  status text not null default 'pending' check (status in ('pending','completed')),
  completed_at timestamptz,
  created_by uuid references hub_staff_profiles(id),
  created_at timestamptz default now()
);

-- ---------- 8. POLICIES & TRAINING ----------
create table if not exists hub_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references hub_businesses(id),
  title text not null,
  category text not null default 'rules'
    check (category in ('rules','commission','attendance','cleaning','service_standards','apprenticeship','training')),
  body text,
  link_url text,
  sort_order int default 0,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ---------- 9. NEWSLETTER ----------
create table if not exists hub_newsletters (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  top_performer_id uuid references hub_staff_profiles(id),
  top_performer_note text,
  weekly_goals text,
  reminders text,
  client_feedback text,
  new_services_promos text,
  improvements_needed text,
  published boolean default false,
  created_at timestamptz default now()
);

-- ---------- 10. CONTENT CENTER ----------
create table if not exists hub_content_submissions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references hub_staff_profiles(id) on delete cascade,
  media_url text,
  media_type text default 'photo' check (media_type in ('photo','video','idea')),
  caption text,
  content_type text default 'work' check (content_type in ('work','before_after','idea')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table hub_businesses            enable row level security;
alter table hub_staff_profiles        enable row level security;
alter table hub_announcements         enable row level security;
alter table hub_announcement_reads    enable row level security;
alter table hub_income_records        enable row level security;
alter table hub_performance_records   enable row level security;
alter table hub_availability          enable row level security;
alter table hub_time_off_requests     enable row level security;
alter table hub_tasks                 enable row level security;
alter table hub_policies              enable row level security;
alter table hub_newsletters           enable row level security;
alter table hub_content_submissions   enable row level security;

-- Businesses: everyone logged in can read, admin writes
create policy biz_read on hub_businesses for select to authenticated using (true);
create policy biz_write on hub_businesses for all to authenticated
  using (hub_is_admin()) with check (hub_is_admin());

-- Staff profiles: team directory readable by all staff; self-edit limited; admin full
create policy prof_read on hub_staff_profiles for select to authenticated using (true);
create policy prof_self_update on hub_staff_profiles for update to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy prof_admin_all on hub_staff_profiles for all to authenticated
  using (hub_is_admin()) with check (hub_is_admin());

-- Announcements: read all, write admin
create policy ann_read on hub_announcements for select to authenticated using (true);
create policy ann_write on hub_announcements for all to authenticated
  using (hub_is_admin()) with check (hub_is_admin());

-- Reads: own rows only (admin can read all for stats)
create policy annread_own on hub_announcement_reads for all to authenticated
  using (staff_id = hub_my_profile_id() or hub_is_admin())
  with check (staff_id = hub_my_profile_id());

-- Income: staff see ONLY their own; admin full control
create policy inc_read on hub_income_records for select to authenticated
  using (staff_id = hub_my_profile_id() or hub_is_admin());
create policy inc_admin on hub_income_records for insert to authenticated
  with check (hub_is_admin());
create policy inc_admin_u on hub_income_records for update to authenticated
  using (hub_is_admin()) with check (hub_is_admin());
create policy inc_admin_d on hub_income_records for delete to authenticated
  using (hub_is_admin());

-- Performance: staff see ONLY their own; admin full control
create policy perf_read on hub_performance_records for select to authenticated
  using (staff_id = hub_my_profile_id() or hub_is_admin());
create policy perf_admin on hub_performance_records for insert to authenticated
  with check (hub_is_admin());
create policy perf_admin_u on hub_performance_records for update to authenticated
  using (hub_is_admin()) with check (hub_is_admin());
create policy perf_admin_d on hub_performance_records for delete to authenticated
  using (hub_is_admin());

-- Availability: own rows; admin sees all
create policy avail_own on hub_availability for all to authenticated
  using (staff_id = hub_my_profile_id() or hub_is_admin())
  with check (staff_id = hub_my_profile_id() or hub_is_admin());

-- Time off: staff create + view own; admin decides
create policy to_read on hub_time_off_requests for select to authenticated
  using (staff_id = hub_my_profile_id() or hub_is_admin());
create policy to_insert on hub_time_off_requests for insert to authenticated
  with check (staff_id = hub_my_profile_id());
create policy to_update on hub_time_off_requests for update to authenticated
  using (hub_is_admin() or (staff_id = hub_my_profile_id() and status = 'pending'))
  with check (hub_is_admin() or staff_id = hub_my_profile_id());
create policy to_delete on hub_time_off_requests for delete to authenticated
  using (hub_is_admin() or (staff_id = hub_my_profile_id() and status = 'pending'));

-- Tasks: assigned staff can read + mark complete; admin full
create policy task_read on hub_tasks for select to authenticated
  using (staff_id = hub_my_profile_id() or hub_is_admin());
create policy task_staff_update on hub_tasks for update to authenticated
  using (staff_id = hub_my_profile_id() or hub_is_admin())
  with check (staff_id = hub_my_profile_id() or hub_is_admin());
create policy task_admin_i on hub_tasks for insert to authenticated
  with check (hub_is_admin());
create policy task_admin_d on hub_tasks for delete to authenticated
  using (hub_is_admin());

-- Policies & training: read all, write admin
create policy pol_read on hub_policies for select to authenticated using (true);
create policy pol_write on hub_policies for all to authenticated
  using (hub_is_admin()) with check (hub_is_admin());

-- Newsletter: staff read published only; admin full
create policy news_read on hub_newsletters for select to authenticated
  using (published or hub_is_admin());
create policy news_write on hub_newsletters for all to authenticated
  using (hub_is_admin()) with check (hub_is_admin());

-- Content: staff create + view own; approved content visible to all; admin full
create policy content_read on hub_content_submissions for select to authenticated
  using (staff_id = hub_my_profile_id() or status = 'approved' or hub_is_admin());
create policy content_insert on hub_content_submissions for insert to authenticated
  with check (staff_id = hub_my_profile_id());
create policy content_update on hub_content_submissions for update to authenticated
  using (hub_is_admin() or (staff_id = hub_my_profile_id() and status = 'pending'))
  with check (hub_is_admin() or staff_id = hub_my_profile_id());
create policy content_delete on hub_content_submissions for delete to authenticated
  using (hub_is_admin() or staff_id = hub_my_profile_id());

-- ============================================================
-- STORAGE : buckets for avatars and content uploads
-- ============================================================
insert into storage.buckets (id, name, public) values
  ('hub-avatars', 'hub-avatars', true),
  ('hub-content', 'hub-content', true)
on conflict (id) do nothing;

create policy hub_storage_read on storage.objects for select to authenticated
  using (bucket_id in ('hub-avatars','hub-content'));
create policy hub_storage_write on storage.objects for insert to authenticated
  with check (bucket_id in ('hub-avatars','hub-content'));
create policy hub_storage_update on storage.objects for update to authenticated
  using (bucket_id in ('hub-avatars','hub-content'));

-- ============================================================
-- SEED : starter team profiles. Profiles link automatically when users sign up
-- with the matching email.
-- ============================================================
do $$
declare
  lounge uuid; beauty uuid;
begin
  select id into lounge from hub_businesses where name = 'RTB Lounge';
  select id into beauty from hub_businesses where name = 'RTB Beauty Lounge';

  insert into hub_staff_profiles (email, full_name, role, job_title, business_id, commission_level, commission_rate) values
    ('ricko@rtblounge.com',  'Ricko',  'admin', 'Owner / Barber', lounge, 'Booth Rent 100%', 1.00),
    ('steph@rtblounge.com',  'Steph',  'staff', 'Barber / Team Lead', lounge, 'Standard 60/40', 0.60),
    ('josh@rtblounge.com',   'Josh',   'staff', 'Barber', lounge, 'Standard 60/40', 0.60),
    ('daniel@rtblounge.com', 'Daniel', 'staff', 'Barber', lounge, 'Standard 60/40', 0.60),
    ('roshi@rtblounge.com',  'Roshi',  'staff', 'Barber', lounge, 'Standard 60/40', 0.60),
    ('darryl@rtblounge.com', 'Darryl', 'staff', 'Barber', lounge, 'Standard 60/40', 0.60),
    ('sara@rtblounge.com',   'Sara',   'staff', 'Beauty Tech', beauty, 'Standard 60/40', 0.60),
    ('leyla@rtblounge.com',  'Leyla',  'staff', 'Beauty Tech', beauty, 'Standard 60/40', 0.60)
  on conflict (email) do nothing;
end $$;;
