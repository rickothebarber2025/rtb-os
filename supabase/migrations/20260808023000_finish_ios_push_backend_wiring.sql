-- Production migration applied in Supabase.
-- Adds native device-token registration, push queue compatibility columns,
-- and event -> push queue triggers for owner activity and Staff Hub coaching.

alter table public.push_device_tokens add column if not exists app_id text not null default 'com.rtbheadquaters.os';
alter table public.push_device_tokens add column if not exists device_name text;
alter table public.push_device_tokens add column if not exists disabled_at timestamptz;

alter table public.push_notification_queue add column if not exists attempt_count integer not null default 0;
alter table public.push_notification_queue add column if not exists next_attempt_at timestamptz not null default now();
alter table public.push_notification_queue add column if not exists processed_at timestamptz;

alter table public.push_notification_queue drop constraint if exists push_notification_queue_status_check;
alter table public.push_notification_queue add constraint push_notification_queue_status_check check(status in ('pending','processing','sent','failed','no_device'));
create index if not exists push_notification_queue_pending_idx on public.push_notification_queue(status,next_attempt_at,created_at);

alter table public.push_device_tokens enable row level security;
grant select,insert,update,delete on public.push_device_tokens to authenticated;
drop policy if exists push_device_tokens_own on public.push_device_tokens;
create policy push_device_tokens_own on public.push_device_tokens for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

drop function if exists public.register_my_push_token(text,text,text,text);
create function public.register_my_push_token(p_token text,p_platform text default 'ios',p_device_name text default null,p_app_id text default 'com.rtbheadquaters.os') returns uuid language plpgsql security definer set search_path=public,auth as $function$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 if nullif(trim(p_token),'') is null then raise exception 'Push token is required.'; end if;
 insert into public.push_device_tokens(user_id,token,platform,bundle_id,app_id,device_name,active,last_seen_at,disabled_at,updated_at)
 values(auth.uid(),trim(p_token),coalesce(nullif(trim(p_platform),''),'ios'),coalesce(nullif(trim(p_app_id),''),'com.rtbheadquaters.os'),coalesce(nullif(trim(p_app_id),''),'com.rtbheadquaters.os'),nullif(trim(p_device_name),''),true,now(),null,now())
 on conflict(token) do update set user_id=excluded.user_id,platform=excluded.platform,bundle_id=excluded.bundle_id,app_id=excluded.app_id,device_name=excluded.device_name,active=true,last_seen_at=now(),disabled_at=null,updated_at=now()
 returning id into v_id;
 return v_id;
end;$function$;
grant execute on function public.register_my_push_token(text,text,text,text) to authenticated;

drop function if exists public.disable_my_push_token(text);
create function public.disable_my_push_token(p_token text) returns boolean language plpgsql security definer set search_path=public,auth as $function$
begin
 update public.push_device_tokens set active=false,disabled_at=now(),updated_at=now() where user_id=auth.uid() and token=p_token;
 return found;
end;$function$;
grant execute on function public.disable_my_push_token(text) to authenticated;

create or replace function private.queue_staff_coaching_push() returns trigger language plpgsql security definer set search_path=public,private as $function$
declare v_user_id uuid;
begin
 select up.id into v_user_id from public.staff s join public.user_profiles up on lower(up.email)=lower(s.email) and up.active where s.id=new.staff_id limit 1;
 if v_user_id is not null then
  insert into public.push_notification_queue(user_id,title,body,data,source_table,source_id,status,next_attempt_at)
  values(v_user_id,new.title,new.body,jsonb_build_object('type','staff_coaching','message_id',new.id,'route','staff-hub'),'staff_ai_coaching_messages',new.id,'pending',now());
 end if;
 return new;
end;$function$;
drop trigger if exists queue_staff_coaching_push on public.staff_ai_coaching_messages;
create trigger queue_staff_coaching_push after insert on public.staff_ai_coaching_messages for each row execute function private.queue_staff_coaching_push();

create or replace function private.queue_owner_activity_push() returns trigger language plpgsql security definer set search_path=public,private as $function$
declare rec record; actor_name text; push_body text;
begin
 select full_name into actor_name from public.staff where id=new.actor_staff_id;
 push_body:=concat_ws(' · ',actor_name,new.body);
 for rec in select id from public.user_profiles where active and (lower(email)='rickothebarber@gmail.com' or role in ('owner','admin')) loop
  insert into public.push_notification_queue(user_id,title,body,data,source_table,source_id,status,next_attempt_at)
  values(rec.id,new.title,coalesce(nullif(push_body,''),new.body,new.title),jsonb_build_object('type','owner_activity','event_id',new.id,'route','operations'),'owner_activity_events',new.id,'pending',now());
 end loop;
 return new;
end;$function$;
drop trigger if exists queue_owner_activity_push on public.owner_activity_events;
create trigger queue_owner_activity_push after insert on public.owner_activity_events for each row execute function private.queue_owner_activity_push();
