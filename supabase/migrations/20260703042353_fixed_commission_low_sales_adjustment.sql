-- Fixed-commission staff now lose 5 percentage points when net sales are below $500.
-- Regular commission staff keep the existing under-$500 floor/drop to 55%.

create or replace function public.calculate_staff_take_home(
  p_net numeric,
  p_tips numeric,
  p_base_comm numeric,
  p_fixed boolean
)
returns table(
  applied_commission_rate numeric,
  adjusted boolean,
  take_home numeric
)
language plpgsql
set search_path = ''
as $function$
begin
  if coalesce(p_net, 0) < 500 and coalesce(p_fixed, false) then
    applied_commission_rate := greatest(coalesce(p_base_comm, 0) - 5, 0);
    adjusted := applied_commission_rate <> coalesce(p_base_comm, 0);
  elsif coalesce(p_net, 0) >= 500 then
    applied_commission_rate := coalesce(p_base_comm, 0);
    adjusted := false;
  else
    applied_commission_rate := least(coalesce(p_base_comm, 0), 55);
    adjusted := applied_commission_rate <> coalesce(p_base_comm, 0);
  end if;

  take_home := greatest(
    0,
    (coalesce(p_net, 0) * applied_commission_rate / 100)
      - 5
      + coalesce(p_tips, 0)
  );
  return next;
end;
$function$;

revoke all on function public.calculate_staff_take_home(numeric, numeric, numeric, boolean)
from public, anon;

grant execute on function public.calculate_staff_take_home(numeric, numeric, numeric, boolean)
to authenticated, service_role;

do $migration$
declare
  fn text;
  original_fn text;
begin
  select pg_get_functiondef('public.save_payroll_draft(jsonb,jsonb)'::regprocedure)
  into fn;

  original_fn := fn;
  fn := replace(
    fn,
    $old$
      case
        when fixed_rate or net_sales >= 500 then base_rate
        else least(base_rate, 55)
      end as applied_rate
    $old$,
    $new$
      case
        when fixed_rate and net_sales < 500 then greatest(base_rate - 5, 0)
        when net_sales >= 500 then base_rate
        else least(base_rate, 55)
      end as applied_rate
    $new$
  );

  if fn = original_fn then
    raise exception 'Expected commission formula not found in public.save_payroll_draft.';
  end if;

  execute fn;
end;
$migration$;

revoke all on function public.save_payroll_draft(jsonb, jsonb)
from public, anon;

grant execute on function public.save_payroll_draft(jsonb, jsonb)
to authenticated;

do $migration$
declare
  fn text;
  original_fn text;
begin
  select pg_get_functiondef('public.sync_google_sheets_payroll(jsonb)'::regprocedure)
  into fn;

  original_fn := fn;
  fn := replace(
    fn,
    $old$
      case
        when fixed_rate or net_sales_amount >= 500 then base_rate
        else least(base_rate, 55)
      end
    $old$,
    $new$
      case
        when fixed_rate and net_sales_amount < 500 then greatest(base_rate - 5, 0)
        when net_sales_amount >= 500 then base_rate
        else least(base_rate, 55)
      end
    $new$
  );

  if fn = original_fn then
    raise exception 'Expected commission formula not found in public.sync_google_sheets_payroll.';
  end if;

  execute fn;
end;
$migration$;

revoke all on function public.sync_google_sheets_payroll(jsonb)
from public, anon, authenticated;

grant execute on function public.sync_google_sheets_payroll(jsonb)
to service_role;
