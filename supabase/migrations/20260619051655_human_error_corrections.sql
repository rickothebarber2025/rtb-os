begin;

alter table public.payroll_runs
  add column if not exists corrected_from_run_id uuid
    references public.payroll_runs(id)
    on delete set null,
  add column if not exists void_reason text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid
    references auth.users(id)
    on delete set null;

alter table public.payroll_runs
  drop constraint if exists payroll_runs_status_check;

alter table public.payroll_runs
  add constraint payroll_runs_status_check
  check (status in ('draft', 'locked', 'sent', 'archived', 'voided'));

create index if not exists payroll_runs_corrected_from_run_id_idx
on public.payroll_runs(corrected_from_run_id);

create or replace function private.protect_payroll_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and old.status in ('locked', 'sent', 'voided') then
    raise exception 'Finalized payroll runs cannot be deleted.';
  end if;

  if tg_op = 'UPDATE' then
    if old.status in ('locked', 'sent') then
      if old.status = 'locked'
        and coalesce(current_setting('rtb.syncing_performance', true), '') = 'on'
        and (to_jsonb(new) - 'performance_saved_at' - 'updated_at')
          = (to_jsonb(old) - 'performance_saved_at' - 'updated_at')
      then
        return new;
      end if;

      if coalesce(current_setting('rtb.voiding_payroll_run', true), '') = 'on'
        and new.status = 'voided'
        and (
          to_jsonb(new)
            - 'status'
            - 'performance_saved_at'
            - 'updated_at'
            - 'void_reason'
            - 'voided_at'
            - 'voided_by'
        ) = (
          to_jsonb(old)
            - 'status'
            - 'performance_saved_at'
            - 'updated_at'
            - 'void_reason'
            - 'voided_at'
            - 'voided_by'
        )
      then
        return new;
      end if;

      raise exception 'Locked payroll runs cannot be changed. Use the correction workflow.';
    end if;

    if old.status = 'voided' then
      raise exception 'Finalized payroll runs cannot be changed.';
    end if;

    if new.status = 'locked'
      and coalesce(current_setting('rtb.locking_payroll_run', true), '') <> 'on'
    then
      raise exception 'Use lock_payroll_run() to finalize payroll.';
    end if;

    if new.status = 'voided'
      and coalesce(current_setting('rtb.voiding_payroll_run', true), '') <> 'on'
    then
      raise exception 'Use create_payroll_correction() to correct finalized payroll.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function private.protect_payroll_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_run_id uuid;
  target_status text;
begin
  target_run_id := case
    when tg_op = 'DELETE' then old.payroll_run_id
    else new.payroll_run_id
  end;

  select pr.status
  into target_status
  from public.payroll_runs pr
  where pr.id = target_run_id;

  if target_status in ('locked', 'sent', 'voided') then
    raise exception 'Entries in a finalized payroll run cannot be changed.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function public.create_payroll_correction(
  p_run_id uuid,
  p_reason text
)
returns public.payroll_runs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  correction_run public.payroll_runs%rowtype;
  target_run public.payroll_runs%rowtype;
begin
  if not private.is_app_admin() then
    raise exception 'Admin access required to correct payroll.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Add a short reason for the payroll correction.';
  end if;

  select pr.*
  into target_run
  from public.payroll_runs pr
  where pr.id = p_run_id
  for update;

  if target_run.id is null then
    raise exception 'Payroll run not found.';
  end if;

  if target_run.status not in ('locked', 'sent') then
    raise exception 'Only finalized payroll can be corrected.';
  end if;

  delete from public.performance_history
  where payroll_run_id = p_run_id;

  perform set_config('rtb.voiding_payroll_run', 'on', true);

  update public.payroll_runs
  set status = 'voided',
      performance_saved_at = null,
      updated_at = now(),
      void_reason = trim(p_reason),
      voided_at = now(),
      voided_by = auth.uid()
  where id = p_run_id
  returning * into target_run;

  insert into public.payroll_runs (
    business_unit_id,
    corrected_from_run_id,
    created_by,
    notes,
    owner_net_sales,
    owner_tips,
    rtb_net,
    status,
    total_deductions,
    total_net_sales,
    total_staff_payout,
    week_end,
    week_label,
    week_start
  )
  values (
    target_run.business_unit_id,
    target_run.id,
    auth.uid(),
    concat_ws(
      E'\n',
      nullif(target_run.notes, ''),
      'Correction: ' || trim(p_reason)
    ),
    target_run.owner_net_sales,
    target_run.owner_tips,
    target_run.rtb_net,
    'draft',
    target_run.total_deductions,
    target_run.total_net_sales,
    target_run.total_staff_payout,
    target_run.week_end,
    target_run.week_label,
    target_run.week_start
  )
  returning * into correction_run;

  insert into public.payroll_entries (
    adjusted,
    applied_commission_rate,
    base_commission_rate,
    deduction,
    fixed_rate_snapshot,
    net_sales,
    notes,
    payroll_run_id,
    paystub_status,
    role_snapshot,
    staff_id,
    staff_name_snapshot,
    take_home,
    tier_snapshot,
    tips
  )
  select
    pe.adjusted,
    pe.applied_commission_rate,
    pe.base_commission_rate,
    pe.deduction,
    pe.fixed_rate_snapshot,
    pe.net_sales,
    pe.notes,
    correction_run.id,
    'pending',
    pe.role_snapshot,
    pe.staff_id,
    pe.staff_name_snapshot,
    pe.take_home,
    pe.tier_snapshot,
    pe.tips
  from public.payroll_entries pe
  where pe.payroll_run_id = target_run.id;

  return correction_run;
end;
$function$;

revoke all on function public.create_payroll_correction(uuid, text)
from public, anon;

grant execute on function public.create_payroll_correction(uuid, text)
to authenticated;

commit;
