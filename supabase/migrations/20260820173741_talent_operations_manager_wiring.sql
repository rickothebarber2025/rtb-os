alter table public.talent_candidates add column if not exists assigned_manager_id uuid references public.user_profiles(id) on delete set null;
create index if not exists talent_candidates_assigned_manager_idx on public.talent_candidates(assigned_manager_id);

create or replace function private.can_view_talent_business(p_business_unit_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select exists (select 1 from public.user_profiles up where up.id=auth.uid() and up.active and (
    lower(coalesce(up.email,''))='rickothebarber@gmail.com' or ((lower(coalesce(up.permissions #>> '{modules,roster}','none')) in ('view','edit','admin') or lower(coalesce(up.permissions #>> '{modules,operations}','none')) in ('view','edit','admin')) and (coalesce(up.permissions ->> 'business_scope','')='all' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? 'all-businesses' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? p_business_unit_id::text or up.business_unit_id=p_business_unit_id))));
$$;

create or replace function private.can_manage_talent_business(p_business_unit_id uuid)
returns boolean language sql stable security definer set search_path=public,auth as $$
  select exists (select 1 from public.user_profiles up where up.id=auth.uid() and up.active and (
    lower(coalesce(up.email,''))='rickothebarber@gmail.com' or ((lower(coalesce(up.permissions #>> '{modules,roster}','none')) in ('edit','admin') or lower(coalesce(up.permissions #>> '{modules,operations}','none')) in ('edit','admin')) and (coalesce(up.permissions ->> 'business_scope','')='all' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? 'all-businesses' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? p_business_unit_id::text or up.business_unit_id=p_business_unit_id))));
$$;

drop policy if exists talent_candidates_select on public.talent_candidates;
create policy talent_candidates_select on public.talent_candidates for select to authenticated using(private.can_view_talent_business(business_unit_id));
drop policy if exists talent_reviews_select on public.talent_reviews;
create policy talent_reviews_select on public.talent_reviews for select to authenticated using(private.can_view_talent_business(business_unit_id));

create or replace function public.get_talent_manager_options(p_business_unit_id uuid)
returns table(id uuid,full_name text,email text,role_title text,operations_permission text)
language sql stable security definer set search_path=public,auth as $$
  select up.id,up.full_name,up.email,up.role_title,coalesce(up.permissions #>> '{modules,operations}','none')
  from public.user_profiles up
  where private.can_view_talent_business(p_business_unit_id) and up.active and lower(coalesce(up.email,''))<>'rickothebarber@gmail.com'
    and lower(coalesce(up.permissions #>> '{modules,operations}','none')) in ('edit','admin')
    and (coalesce(up.permissions ->> 'business_scope','')='all' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? 'all-businesses' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? p_business_unit_id::text or up.business_unit_id=p_business_unit_id)
  order by case when lower(coalesce(up.role_title,'')) like '%manager%' then 0 else 1 end,up.full_name;
$$;
revoke all on function public.get_talent_manager_options(uuid) from public,anon;
grant execute on function public.get_talent_manager_options(uuid) to authenticated;

create or replace function private.auto_assign_talent_manager()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_manager uuid; v_count int;
begin
  if new.assigned_manager_id is not null then return new; end if;
  select count(*),min(up.id) into v_count,v_manager from public.user_profiles up
  where up.active and lower(coalesce(up.email,''))<>'rickothebarber@gmail.com'
    and lower(coalesce(up.permissions #>> '{modules,operations}','none')) in ('edit','admin')
    and (coalesce(up.permissions ->> 'business_scope','')='all' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? 'all-businesses' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? new.business_unit_id::text or up.business_unit_id=new.business_unit_id);
  if v_count=1 then new.assigned_manager_id:=v_manager; end if;
  return new;
end; $$;
drop trigger if exists talent_auto_assign_manager on public.talent_candidates;
create trigger talent_auto_assign_manager before insert on public.talent_candidates for each row execute function private.auto_assign_talent_manager();

drop view if exists public.talent_pipeline_summary;
create view public.talent_pipeline_summary with (security_invoker=true) as
select c.id,c.business_unit_id,c.staff_id,c.full_name,c.email,c.phone,c.specialty,c.stage,c.hiring_reason,c.source,c.start_date,c.stage_started_at,c.public_booking_enabled,c.walk_ins_enabled,c.social_visibility_enabled,c.permanent_brand_endorsement,c.notes,c.exit_reason,c.created_by,c.created_at,c.updated_at,c.assigned_manager_id,mgr.full_name assigned_manager_name,mgr.email assigned_manager_email,r.review_day latest_review_day,r.review_date latest_review_date,
round(((((((((r.attendance*.20)+(r.reliability*.15))+(r.service_quality*.15))+(r.client_experience*.15))+(r.rebooking_retention*.10))+(r.policy_compliance*.10))+(r.professionalism*.10))+(r.content_participation*.05)),1) fit_score,
case when coalesce(r.qualified_leads,0)>0 then round((r.bookings_from_opportunities::numeric/r.qualified_leads::numeric)*100,1) else null end opportunity_conversion_rate,r.critical_failure,r.recommendation
from public.talent_candidates c left join public.user_profiles mgr on mgr.id=c.assigned_manager_id left join lateral(select tr.* from public.talent_reviews tr where tr.candidate_id=c.id order by tr.review_day desc limit 1)r on true;
grant select on public.talent_pipeline_summary to authenticated;
