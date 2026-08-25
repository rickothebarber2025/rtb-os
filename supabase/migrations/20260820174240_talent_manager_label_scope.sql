create or replace function public.talent_manager_name(p_manager_id uuid,p_business_unit_id uuid)
returns text language sql stable security definer set search_path=public,auth as $$
  select case when private.can_view_talent_business(p_business_unit_id)
    then (select up.full_name from public.user_profiles up where up.id=p_manager_id and up.active limit 1)
    else null end;
$$;
revoke all on function public.talent_manager_name(uuid,uuid) from public,anon;
grant execute on function public.talent_manager_name(uuid,uuid) to authenticated;

drop view if exists public.talent_pipeline_summary;
create view public.talent_pipeline_summary with (security_invoker=true) as
select c.id,c.business_unit_id,c.staff_id,c.full_name,c.email,c.phone,c.specialty,c.stage,c.hiring_reason,c.source,c.start_date,c.stage_started_at,c.public_booking_enabled,c.walk_ins_enabled,c.social_visibility_enabled,c.permanent_brand_endorsement,c.notes,c.exit_reason,c.created_by,c.created_at,c.updated_at,c.assigned_manager_id,
       public.talent_manager_name(c.assigned_manager_id,c.business_unit_id) assigned_manager_name,
       r.review_day latest_review_day,r.review_date latest_review_date,
       round(((((((((r.attendance*.20)+(r.reliability*.15))+(r.service_quality*.15))+(r.client_experience*.15))+(r.rebooking_retention*.10))+(r.policy_compliance*.10))+(r.professionalism*.10))+(r.content_participation*.05)),1) fit_score,
       case when coalesce(r.qualified_leads,0)>0 then round((r.bookings_from_opportunities::numeric/r.qualified_leads::numeric)*100,1) else null end opportunity_conversion_rate,
       r.critical_failure,r.recommendation
from public.talent_candidates c
left join lateral(select tr.* from public.talent_reviews tr where tr.candidate_id=c.id order by tr.review_day desc limit 1)r on true;
grant select on public.talent_pipeline_summary to authenticated;
