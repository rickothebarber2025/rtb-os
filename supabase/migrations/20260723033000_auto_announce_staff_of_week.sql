begin;

-- Automatically posts a "Staff of the Week" announcement (name only,
-- no dollar amounts) to Staff Hub every time a payroll run is
-- finalized, so all staff can see who topped that week without
-- seeing anyone's actual numbers.
--
-- Runs as its own SECURITY DEFINER function rather than folding
-- directly into lock_payroll_run: that function runs as the calling
-- user (not security definer), and hub_announcements' RLS requires
-- hub_is_admin() specifically (a different permission system than
-- the is_app_admin() check lock_payroll_run already uses) -- so a
-- direct insert there could fail for an admin who has payroll access
-- but isn't also a hub_staff_profiles admin. Isolating this in its
-- own definer function avoids that coupling, and lock_payroll_run
-- wraps the call so a failure here can never block finalizing
-- payroll, which must always succeed regardless of this feature.
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
  from public.payroll_entries
  where payroll_run_id = p_run_id;

  -- Need at least 2 people for "top performer" to mean anything.
  if staff_count < 2 then
    return;
  end if;

  -- hub_announcements lives in the hub_businesses ID space, which is
  -- separate from business_units; the only shared key is name.
  select hb.id into hub_business_id
  from public.hub_businesses hb
  join public.business_units bu on lower(trim(bu.name)) = lower(trim(hb.name))
  where bu.id = run_business_unit_id;

  if hub_business_id is null then
    return;
  end if;

  -- Handle ties fairly: name everyone tied for the top spot rather
  -- than arbitrarily picking one.
  select array_agg(staff_name_snapshot order by staff_name_snapshot)
  into winner_names
  from public.payroll_entries
  where payroll_run_id = p_run_id
    and net_sales = (
      select max(net_sales) from public.payroll_entries where payroll_run_id = p_run_id
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
    -- Never let this feature block a payroll lock.
    return;
end;
$fn$;

revoke all on function private.announce_staff_of_week(uuid) from public, anon, authenticated;

create or replace function public.lock_payroll_run(p_run_id uuid)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  target_run public.payroll_runs%rowtype;
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to finalize payroll.';
  end if;

  select pr.*
  into target_run
  from public.payroll_runs pr
  where pr.id = p_run_id
  for update;

  if target_run.id is null then
    raise exception 'Payroll run not found.';
  end if;

  if target_run.status <> 'draft' then
    raise exception 'Only draft payroll runs can be finalized.';
  end if;

  if target_run.week_start is null or target_run.week_end is null then
    raise exception 'Payroll week start and end dates are required before finalizing.';
  end if;

  if not exists (
    select 1
    from public.payroll_entries pe
    where pe.payroll_run_id = p_run_id
  ) then
    raise exception 'Add at least one staff payroll entry before finalizing.';
  end if;

  if coalesce(target_run.total_net_sales, 0) = 0
    and coalesce(target_run.owner_tips, 0) = 0
    and not exists (
      select 1
      from public.payroll_entries pe
      where pe.payroll_run_id = p_run_id
        and coalesce(pe.tips, 0) > 0
    )
  then
    raise exception 'Enter payroll sales or tips before finalizing.';
  end if;

  if exists (
    select 1
    from public.payroll_runs existing
    where existing.id <> p_run_id
      and existing.business_unit_id is not distinct from target_run.business_unit_id
      and existing.week_start is not distinct from target_run.week_start
      and existing.status in ('locked', 'sent')
  ) then
    raise exception 'A finalized payroll run already exists for this business and week.';
  end if;

  perform set_config('rtb.locking_payroll_run', 'on', true);

  update public.payroll_runs
  set status = 'locked',
      locked_at = now(),
      performance_saved_at = now(),
      updated_at = now()
  where id = p_run_id;

  perform private.sync_performance_from_run(p_run_id);

  begin
    perform private.announce_staff_of_week(p_run_id);
  exception
    when others then
      null;
  end;
end;
$function$;

commit;
