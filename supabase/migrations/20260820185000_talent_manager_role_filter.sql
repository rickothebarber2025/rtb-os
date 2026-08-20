create or replace function public.get_talent_manager_options(p_business_unit_id uuid)
returns table(id uuid,full_name text,email text,role_title text,operations_permission text)
language sql stable security definer set search_path=public,auth as $$
  select up.id,up.full_name,up.email,up.role_title,coalesce(up.permissions #>> '{modules,operations}','none')
  from public.user_profiles up
  where private.can_view_talent_business(p_business_unit_id) and up.active
    and lower(coalesce(up.email,'')) <> 'rickothebarber@gmail.com'
    and lower(coalesce(up.role_title,'')) not in ('owner','full admin','legacy admin')
    and lower(coalesce(up.permissions #>> '{modules,operations}','none')) in ('edit','admin')
    and (lower(coalesce(up.role,''))='manager' or lower(coalesce(up.role_title,'')) like '%operations%' or coalesce(up.permissions ->> 'role_template','') in ('beauty_manager','barbershop_manager','operations_assistant'))
    and (coalesce(up.permissions ->> 'business_scope','')='all' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? 'all-businesses' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? p_business_unit_id::text or up.business_unit_id=p_business_unit_id)
  order by case when lower(coalesce(up.role_title,'')) like '%manager%' then 0 else 1 end,up.full_name;
$$;

create or replace function private.auto_assign_talent_manager()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_manager uuid; v_count int;
begin
  if new.assigned_manager_id is not null then return new; end if;
  select count(*),min(up.id) into v_count,v_manager from public.user_profiles up
  where up.active and lower(coalesce(up.email,'')) <> 'rickothebarber@gmail.com'
    and lower(coalesce(up.role_title,'')) not in ('owner','full admin','legacy admin')
    and lower(coalesce(up.permissions #>> '{modules,operations}','none')) in ('edit','admin')
    and (lower(coalesce(up.role,''))='manager' or lower(coalesce(up.role_title,'')) like '%operations%' or coalesce(up.permissions ->> 'role_template','') in ('beauty_manager','barbershop_manager','operations_assistant'))
    and (coalesce(up.permissions ->> 'business_scope','')='all' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? 'all-businesses' or coalesce(up.permissions -> 'business_unit_ids','[]'::jsonb) ? new.business_unit_id::text or up.business_unit_id=new.business_unit_id);
  if v_count=1 then new.assigned_manager_id:=v_manager; end if;
  return new;
end; $$;
