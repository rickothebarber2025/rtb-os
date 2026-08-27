begin;

create table if not exists public.staff_ai_coaching_messages (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  message_date date not null default (now() at time zone 'America/Toronto')::date,
  message_type text not null check (message_type in ('daily_focus','career_progress','app_reminder','accountability')),
  title text not null,
  body text not null,
  focus_points jsonb not null default '[]'::jsonb,
  career_progress jsonb not null default '{}'::jsonb,
  shop_contribution jsonb not null default '{}'::jsonb,
  generated_by text not null default 'system',
  model text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id, message_date, message_type)
);

create index if not exists staff_ai_coaching_staff_unread_idx on public.staff_ai_coaching_messages(staff_id, read_at, created_at desc);
alter table public.staff_ai_coaching_messages enable row level security;
grant select, update on public.staff_ai_coaching_messages to authenticated;

drop policy if exists staff_ai_coaching_select on public.staff_ai_coaching_messages;
create policy staff_ai_coaching_select on public.staff_ai_coaching_messages for select to authenticated
using (staff_id=private.current_staff_id() or private.staff_hub_business_admin(business_unit_id,'view') or private.is_app_admin());

drop policy if exists staff_ai_coaching_update on public.staff_ai_coaching_messages;
create policy staff_ai_coaching_update on public.staff_ai_coaching_messages for update to authenticated
using (staff_id=private.current_staff_id()) with check (staff_id=private.current_staff_id());

create or replace function public.get_my_ai_coaching() returns jsonb language sql security definer set search_path=public,private as $function$
  with me as (select private.current_staff_id() as staff_id), rows as (
    select m.* from public.staff_ai_coaching_messages m,me where m.staff_id=me.staff_id order by m.created_at desc limit 20
  )
  select jsonb_build_object('unread_count',count(*) filter(where read_at is null),'messages',coalesce(jsonb_agg(to_jsonb(rows) order by created_at desc),'[]'::jsonb)) from rows;
$function$;
grant execute on function public.get_my_ai_coaching() to authenticated;

create or replace function public.mark_my_ai_coaching_read(p_message_id uuid default null) returns integer language plpgsql security definer set search_path=public,private as $function$
declare affected integer;
begin
 update public.staff_ai_coaching_messages set read_at=coalesce(read_at,now()),updated_at=now()
 where staff_id=private.current_staff_id() and (p_message_id is null or id=p_message_id) and read_at is null;
 get diagnostics affected=row_count; return affected;
end;$function$;
grant execute on function public.mark_my_ai_coaching_read(uuid) to authenticated;

create or replace function public.generate_staff_app_reminders() returns jsonb language plpgsql security definer set search_path=public,private,auth as $function$
declare v_today date:=(now() at time zone 'America/Toronto')::date;v_created integer:=0;rec record;
begin
 for rec in
   select s.id staff_id,s.business_unit_id,s.full_name,up.id user_id,au.last_sign_in_at,
    (select count(*) from public.staff_tasks t where t.staff_id=s.id and t.status not in ('completed','done','closed') and t.due_date<=v_today) overdue_tasks,
    (select count(*) from public.staff_shift_records sr where sr.staff_id=s.id and sr.shift_date>=v_today-7 and (sr.missed_shift or sr.missed_checkout or coalesce(sr.late_minutes,0)>0)) recent_attendance_flags
   from public.staff s join public.user_profiles up on lower(up.email)=lower(s.email) and up.active join auth.users au on au.id=up.id where s.active
 loop
   if rec.last_sign_in_at is null or rec.last_sign_in_at<now()-interval '36 hours' then
    insert into public.staff_ai_coaching_messages(staff_id,business_unit_id,message_date,message_type,title,body,focus_points,generated_by)
    values(rec.staff_id,rec.business_unit_id,v_today,'app_reminder','Check your RTB Hub today','Open RTB OS and review your Staff Hub. Your tasks, schedule, operations responsibilities, and performance progress are tracked here.',jsonb_build_array('Review today''s tasks','Check your schedule','Complete any required opening/closing or operations steps'),'system')
    on conflict(staff_id,message_date,message_type) do nothing;
    if found then v_created:=v_created+1; end if;
   end if;
   if rec.overdue_tasks>0 or rec.recent_attendance_flags>0 then
    insert into public.staff_ai_coaching_messages(staff_id,business_unit_id,message_date,message_type,title,body,focus_points,career_progress,shop_contribution,generated_by)
    values(rec.staff_id,rec.business_unit_id,v_today,'accountability','Your RTB focus needs attention',format('You currently have %s overdue task(s) and %s recent attendance/accountability flag(s). Use Staff Hub to clear these items and keep your RTB growth record strong.',rec.overdue_tasks,rec.recent_attendance_flags),jsonb_build_array('Clear overdue responsibilities','Review attendance records','Use RTB OS consistently'),jsonb_build_object('status','needs_attention','message','Consistency and follow-through directly affect advancement, trust, and eligibility for higher responsibility.'),jsonb_build_object('overdue_tasks',rec.overdue_tasks,'attendance_flags_7d',rec.recent_attendance_flags),'system')
    on conflict(staff_id,message_date,message_type) do update set body=excluded.body,focus_points=excluded.focus_points,career_progress=excluded.career_progress,shop_contribution=excluded.shop_contribution,updated_at=now();
   end if;
 end loop;
 return jsonb_build_object('created',v_created,'ran_at',now());
end;$function$;

do $do$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $unschedule$
      select cron.unschedule(jobid)
      from cron.job
      where jobname = 'rtb-staff-app-reminders'
    $unschedule$;
    execute $schedule$
      select cron.schedule(
        'rtb-staff-app-reminders',
        '0 13 * * *',
        'select public.generate_staff_app_reminders();'
      )
    $schedule$;
  end if;
exception when others then
  null;
end
$do$;

commit;
