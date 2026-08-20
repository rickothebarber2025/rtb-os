create or replace function private.finance_reconciliation_calendar_propagation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_bank_date date; v_event_id uuid;
begin
  if new.status<>'confirmed' or (tg_op='UPDATE' and old.status='confirmed') then return new; end if;
  select transaction_date into v_bank_date from public.finance_transactions where id=new.bank_transaction_id;
  if new.match_type='obligation' then
    select id into v_event_id from public.finance_calendar_events where business_unit_id=new.business_unit_id and source_type='obligation' and source_id=new.matched_id and abs(event_date-v_bank_date)<=14 order by abs(event_date-v_bank_date) limit 1;
  elsif new.match_type in ('payroll_entry','payroll_run') then
    select id into v_event_id from public.finance_calendar_events where business_unit_id=new.business_unit_id and event_type='payroll' and abs(event_date-v_bank_date)<=10 order by abs(event_date-v_bank_date) limit 1;
  end if;
  if v_event_id is not null then
    update public.finance_calendar_events set status='confirmed',linked_transaction_id=new.bank_transaction_id,confidence=100,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('reconciliation_id',new.id,'match_type',new.match_type,'confirmed_at',now()),updated_at=now() where id=v_event_id;
  end if;
  return new;
end; $$;
revoke all on function private.finance_reconciliation_calendar_propagation() from public,anon,authenticated;
drop trigger if exists finance_reconciliation_calendar_propagation on public.finance_reconciliations;
create trigger finance_reconciliation_calendar_propagation after insert or update of status on public.finance_reconciliations for each row execute function private.finance_reconciliation_calendar_propagation();

create or replace function private.refresh_finance_confirmed_forecast_totals(p_business_unit_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_h integer;
begin
  foreach v_h in array array[7,30,60,90] loop
    update public.finance_forecast_snapshots f
    set confirmed_in=coalesce((select sum(expected_amount) from public.finance_calendar_events where business_unit_id=p_business_unit_id and direction='income' and status='confirmed' and event_date between current_date and current_date+v_h),0),
        confirmed_out=coalesce((select sum(expected_amount) from public.finance_calendar_events where business_unit_id=p_business_unit_id and direction='expense' and status='confirmed' and event_date between current_date and current_date+v_h),0)
    where f.business_unit_id=p_business_unit_id and f.horizon_days=v_h;
  end loop;
end; $$;
revoke all on function private.refresh_finance_confirmed_forecast_totals(uuid) from public,anon,authenticated;

create or replace function private.finance_calendar_confirmed_refresh_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform private.refresh_finance_confirmed_forecast_totals(coalesce(new.business_unit_id,old.business_unit_id)); return coalesce(new,old); end; $$;
revoke all on function private.finance_calendar_confirmed_refresh_trigger() from public,anon,authenticated;
drop trigger if exists finance_calendar_confirmed_refresh on public.finance_calendar_events;
create trigger finance_calendar_confirmed_refresh after update of status,expected_amount or delete on public.finance_calendar_events for each row execute function private.finance_calendar_confirmed_refresh_trigger();

create or replace function private.finance_forecast_risk_alert_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_title text;
begin
  if new.risk_level='normal' then return new; end if;
  v_title:=new.horizon_days::text||'-day cash-flow forecast needs attention';
  if not exists(select 1 from public.owner_activity_events where business_unit_id=new.business_unit_id and action='forecast_risk' and title=v_title and created_at>=current_date) then
    insert into public.owner_activity_events (business_unit_id,category,action,title,body,source_table,metadata)
    values (new.business_unit_id,'finance','forecast_risk',v_title,'Expected outflow '||to_char(new.expected_out,'FM999999990.00')||' vs inflow '||to_char(new.expected_in,'FM999999990.00')||'; projected net '||to_char(new.expected_net,'FM999999990.00')||'.','finance_forecast_snapshots',jsonb_build_object('horizon_days',new.horizon_days,'expected_in',new.expected_in,'expected_out',new.expected_out,'expected_net',new.expected_net,'risk_level',new.risk_level));
  end if;
  return new;
end; $$;
revoke all on function private.finance_forecast_risk_alert_trigger() from public,anon,authenticated;
drop trigger if exists finance_forecast_risk_alert on public.finance_forecast_snapshots;
create trigger finance_forecast_risk_alert after insert on public.finance_forecast_snapshots for each row execute function private.finance_forecast_risk_alert_trigger();
