create or replace function private.announce_staff_of_week(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  run_business_unit_id uuid;
  run_week_label text;
  hub_business_id uuid;
  winner_names text[];
  staff_count int;
  announcer_id uuid;
begin
  select business_unit_id, week_label
  into run_business_unit_id, run_week_label
  from public.payroll_runs
  where id = p_run_id;

  if run_business_unit_id is null then
    return;
  end if;

  select count(*) into staff_count
  from public.payroll_entries pe
  join public.staff s on s.id = pe.staff_id
  where pe.payroll_run_id = p_run_id
    and not coalesce(s.exclude_from_leaderboard, false);

  -- Need at least 2 eligible people for "top performer" to mean anything.
  if staff_count < 2 then
    return;
  end if;

  select hb.id into hub_business_id
  from public.hub_businesses hb
  join public.business_units bu on lower(trim(bu.name)) = lower(trim(hb.name))
  where bu.id = run_business_unit_id;

  if hub_business_id is null then
    return;
  end if;

  -- Only consider staff not flagged out of leaderboard/award
  -- consideration (e.g. the owner, tracked normally but not ranked).
  select array_agg(pe.staff_name_snapshot order by pe.staff_name_snapshot)
  into winner_names
  from public.payroll_entries pe
  join public.staff s on s.id = pe.staff_id
  where pe.payroll_run_id = p_run_id
    and not coalesce(s.exclude_from_leaderboard, false)
    and pe.net_sales = (
      select max(pe2.net_sales)
      from public.payroll_entries pe2
      join public.staff s2 on s2.id = pe2.staff_id
      where pe2.payroll_run_id = p_run_id
        and not coalesce(s2.exclude_from_leaderboard, false)
    );

  if winner_names is null or array_length(winner_names, 1) = 0 then
    return;
  end if;

  announcer_id := private.hub_my_profile_id();

  insert into public.hub_announcements (business_id, title, body, category, pinned, created_by)
  values (
    hub_business_id,
    'Staff of the Week',
    case
      when array_length(winner_names, 1) = 1 then
        'Staff of the Week for ' || coalesce(run_week_label, 'this week') || ' goes to ' || winner_names[1] || '! Congratulations!'
      else
        'Staff of the Week for ' || coalesce(run_week_label, 'this week') || ' is shared by ' || array_to_string(winner_names, ', ') || '! Congratulations!'
    end,
    'event',
    true,
    announcer_id
  );
exception
  when others then
    return;
end;
$fn$;;
