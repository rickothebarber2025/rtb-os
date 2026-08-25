drop policy if exists staff_warnings_insert on public.staff_warnings;
create policy staff_warnings_insert on public.staff_warnings
for insert to authenticated
with check (private.can_access_business_module(business_unit_id, 'roster', 'edit'));

drop policy if exists staff_warnings_update on public.staff_warnings;
create policy staff_warnings_update on public.staff_warnings
for update to authenticated
using (private.can_access_business_module(business_unit_id, 'roster', 'edit'))
with check (private.can_access_business_module(business_unit_id, 'roster', 'edit'));

drop policy if exists staff_warnings_delete on public.staff_warnings;
create policy staff_warnings_delete on public.staff_warnings
for delete to authenticated
using (private.can_access_business_module(business_unit_id, 'roster', 'admin'));

create or replace function private.enforce_staff_time_off_notice()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_start timestamptz;
  v_hours integer;
  v_is_self boolean;
begin
  v_start := (new.start_date::timestamp at time zone 'America/Toronto');
  v_hours := floor(extract(epoch from (v_start - now())) / 3600);
  new.notice_hours := v_hours;
  new.meets_notice_policy := v_hours >= 48;
  new.updated_at := now();
  v_is_self := new.staff_id = private.current_staff_id();
  if new.status = 'pending' and v_is_self and not new.meets_notice_policy
     and (tg_op = 'INSERT' or old.start_date is distinct from new.start_date) then
    raise exception 'Time-off requests require at least 48 hours notice. If this is an emergency, contact management directly.';
  end if;
  return new;
end;
$$;

create or replace function public.acknowledge_my_staff_warning(p_warning_id uuid)
returns public.staff_warnings
language plpgsql security definer set search_path = public, private as $$
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
  insert into public.owner_activity_events(business_unit_id,actor_staff_id,category,action,title,body,source_table,source_id,metadata)
  values (v_row.business_unit_id,v_row.staff_id,'staff','warning_acknowledged','Warning acknowledged',v_row.title,'staff_warnings',v_row.id,jsonb_build_object('priority','info','page','staff','action_label','Open staff profile'));
  return v_row;
end;
$$;
revoke all on function public.acknowledge_my_staff_warning(uuid) from public;
grant execute on function public.acknowledge_my_staff_warning(uuid) to authenticated;
