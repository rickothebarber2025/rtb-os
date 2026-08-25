create or replace function public.rtb_disable_beauty_walkin_coverage_tasks()
returns trigger
language plpgsql
as $$
begin
  if new.business_unit_id = 'f39374d8-7518-435d-9f8f-7af1cd42bff9'::uuid
     and coalesce(new.title, '') ilike 'Confirm walk-in coverage%' then
    new.details := trim(both from concat_ws(' ', nullif(new.details, ''), '[WALKIN_COVERAGE] [SQUARE_MANAGED]'));
    new.status := 'completed';
    new.completed_at := coalesce(new.completed_at, now());
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists rtb_disable_beauty_walkin_coverage_tasks on public.staff_tasks;
create trigger rtb_disable_beauty_walkin_coverage_tasks
before insert or update of title, business_unit_id, status on public.staff_tasks
for each row
execute function public.rtb_disable_beauty_walkin_coverage_tasks();

update public.staff_tasks
set details = trim(both from concat_ws(' ', nullif(details, ''), '[WALKIN_COVERAGE] [SQUARE_MANAGED]')),
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
where business_unit_id = 'f39374d8-7518-435d-9f8f-7af1cd42bff9'::uuid
  and title ilike 'Confirm walk-in coverage%';
