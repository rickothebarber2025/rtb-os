with eligible as (
  select tc.id candidate_id,(array_agg(up.id))[1] manager_id,count(*) manager_count
  from public.talent_candidates tc
  join public.user_profiles up on up.active
    and lower(coalesce(up.email,'')) <> 'rickothebarber@gmail.com'
    and lower(coalesce(up.role_title,'')) not in ('owner','full admin','legacy admin')
    and lower(coalesce(up.permissions #>> '{modules,operations}','none')) in ('edit','admin')
    and (lower(coalesce(up.role,''))='manager' or lower(coalesce(up.role_title,'')) like '%operations%' or coalesce(up.permissions ->> 'role_template','') in ('beauty_manager','barbershop_manager','operations_assistant'))
    and (coalesce(up.permissions ->> 'business_scope','')='all' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? 'all-businesses' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? tc.business_unit_id::text or up.business_unit_id=tc.business_unit_id)
  where tc.assigned_manager_id is null
  group by tc.id
)
update public.talent_candidates tc set assigned_manager_id=e.manager_id,updated_at=now()
from eligible e where e.candidate_id=tc.id and e.manager_count=1;
