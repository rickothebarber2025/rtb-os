create or replace function private.refresh_finance_calendar_forecast(p_business_unit_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_sales_source uuid; v_sales_weekly numeric:=0; v_payroll_source uuid; v_payroll_weekly numeric:=0; v_payroll_end date;
  v_horizon integer; v_in numeric; v_out numeric; v_net numeric; v_risk text;
begin
  delete from public.finance_calendar_events where business_unit_id=p_business_unit_id and event_date>=current_date and status in ('predicted','scheduled') and source_type in ('sales_prediction','payroll_prediction','obligation','recurring_pattern');

  select id into v_sales_source from public.finance_transactions where business_unit_id=p_business_unit_id and source='square' order by transaction_date desc,created_at desc limit 1;
  select coalesce(sum(amount),0)/4 into v_sales_weekly from public.finance_transactions where business_unit_id=p_business_unit_id and source='square' and transaction_date>=current_date-28;
  if v_sales_source is not null and v_sales_weekly>0 then
    insert into public.finance_calendar_events (business_unit_id,event_date,event_type,label,direction,expected_amount,status,confidence,source_type,source_id,metadata)
    select p_business_unit_id,d::date,'sales','Expected weekly Square sales','income',round(v_sales_weekly,2),'predicted',65,'sales_prediction',v_sales_source,jsonb_build_object('basis','last_28_days_square_sales')
    from generate_series(current_date+7,current_date+90,interval '7 days') d
    on conflict (business_unit_id,source_type,source_id,event_date) where source_id is not null do update set expected_amount=excluded.expected_amount,confidence=excluded.confidence,metadata=excluded.metadata,updated_at=now();
  end if;

  select id,coalesce(week_end,week_start) into v_payroll_source,v_payroll_end from public.payroll_runs where business_unit_id=p_business_unit_id and status='locked' order by coalesce(week_end,week_start) desc limit 1;
  select coalesce(avg(total_staff_payout),0) into v_payroll_weekly from (select total_staff_payout from public.payroll_runs where business_unit_id=p_business_unit_id and status='locked' order by coalesce(week_end,week_start) desc limit 6) q;
  if v_payroll_source is not null and v_payroll_weekly>0 then
    insert into public.finance_calendar_events (business_unit_id,event_date,event_type,label,direction,expected_amount,status,confidence,source_type,source_id,metadata)
    select p_business_unit_id,d::date,'payroll','Expected staff payroll','expense',round(v_payroll_weekly,2),'predicted',80,'payroll_prediction',v_payroll_source,jsonb_build_object('basis','last_6_locked_payroll_runs')
    from generate_series(greatest(current_date+1,v_payroll_end+7),current_date+90,interval '7 days') d
    on conflict (business_unit_id,source_type,source_id,event_date) where source_id is not null do update set expected_amount=excluded.expected_amount,confidence=excluded.confidence,metadata=excluded.metadata,updated_at=now();
  end if;

  insert into public.finance_calendar_events (business_unit_id,event_date,event_type,label,direction,expected_amount,status,confidence,source_type,source_id,metadata)
  select o.business_unit_id,
    make_date(extract(year from m)::int,extract(month from m)::int,least(o.due_day,extract(day from(date_trunc('month',m)+interval '1 month - 1 day'))::int)),
    'obligation',o.name,'expense',o.amount,'scheduled',100,'obligation',o.id,jsonb_build_object('frequency',o.frequency,'category',o.category)
  from public.finance_obligations o cross join generate_series(date_trunc('month',current_date),date_trunc('month',current_date+90),interval '1 month') m
  where o.business_unit_id=p_business_unit_id and o.status='active'
  on conflict (business_unit_id,source_type,source_id,event_date) where source_id is not null do update set expected_amount=excluded.expected_amount,label=excluded.label,metadata=excluded.metadata,updated_at=now();

  insert into public.finance_calendar_events (business_unit_id,event_date,event_type,label,direction,expected_amount,status,confidence,source_type,source_id,metadata)
  select p.business_unit_id,(p.next_expected_date+(g.n*p.interval_days))::date,'recurring_expense',p.label,'expense',p.avg_amount,'predicted',p.confidence,'recurring_pattern',p.id,
    jsonb_build_object('cadence',p.cadence,'occurrences',p.occurrence_count,'variance',p.amount_variance)
  from public.finance_recurring_patterns p cross join lateral generate_series(0,greatest(0,floor(90.0/greatest(p.interval_days,1)))::int) g(n)
  where p.business_unit_id=p_business_unit_id and p.active and p.direction='expense' and p.next_expected_date is not null
    and (p.next_expected_date+(g.n*p.interval_days)) between current_date and current_date+90
  on conflict (business_unit_id,source_type,source_id,event_date) where source_id is not null do update set expected_amount=excluded.expected_amount,label=excluded.label,confidence=excluded.confidence,metadata=excluded.metadata,updated_at=now();

  delete from public.finance_forecast_snapshots where business_unit_id=p_business_unit_id;
  foreach v_horizon in array array[7,30,60,90] loop
    select coalesce(sum(expected_amount) filter(where direction='income' and status<>'cancelled'),0),coalesce(sum(expected_amount) filter(where direction='expense' and status<>'cancelled'),0)
      into v_in,v_out from public.finance_calendar_events where business_unit_id=p_business_unit_id and event_date between current_date and current_date+v_horizon;
    v_net:=v_in-v_out; v_risk:=case when v_net>=0 then 'normal' when abs(v_net)>greatest(v_in,1)*0.5 then 'high' else 'watch' end;
    insert into public.finance_forecast_snapshots (business_unit_id,horizon_days,expected_in,expected_out,expected_net,risk_level,details)
    values (p_business_unit_id,v_horizon,v_in,v_out,v_net,v_risk,jsonb_build_object('source','automatic_database_refresh'));
  end loop;
end; $$;
revoke all on function private.refresh_finance_calendar_forecast(uuid) from public,anon,authenticated;

create or replace function private.refresh_finance_recurring_patterns(p_business_unit_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  with base as (
    select business_unit_id,direction,transaction_date,amount,description,trim(regexp_replace(lower(regexp_replace(description,'[0-9]+','','g')),'[^a-z]+',' ','g')) merchant_key
    from public.finance_transactions where business_unit_id=p_business_unit_id and source='csv' and direction='expense' and transaction_date>=current_date-370
  ), seq as (
    select *,transaction_date-lag(transaction_date) over(partition by direction,merchant_key order by transaction_date) gap_days from base where merchant_key<>''
  ), agg as (
    select direction,merchant_key,(array_agg(description order by transaction_date desc))[1] label,count(*)::int occurrence_count,round(avg(amount),2) avg_amount,
      round(coalesce(stddev_pop(amount),0),2) amount_variance,max(transaction_date) last_seen_date,avg(gap_days::numeric) filter(where gap_days is not null) avg_gap
    from seq group by direction,merchant_key having count(*)>=2
  ), shaped as (
    select *,case when avg_gap<=10 then 'weekly' when avg_gap<=20 then 'biweekly' when avg_gap<=45 then 'monthly' when avg_gap<=120 then 'quarterly' when avg_gap<=420 then 'yearly' else 'irregular' end cadence,
      case when avg_gap<=10 then 7 when avg_gap<=20 then 14 when avg_gap<=45 then 30 when avg_gap<=120 then 91 when avg_gap<=420 then 365 else greatest(1,round(avg_gap)::int) end interval_days
    from agg where avg_gap is not null
  )
  insert into public.finance_recurring_patterns (business_unit_id,merchant_key,label,direction,avg_amount,amount_variance,cadence,interval_days,occurrence_count,last_seen_date,next_expected_date,confidence,active,updated_at)
  select p_business_unit_id,merchant_key,label,direction,avg_amount,amount_variance,cadence,interval_days,occurrence_count,last_seen_date,last_seen_date+interval_days,
    least(95,greatest(55,55+least(20,occurrence_count*4)+case when avg_amount>0 and amount_variance/avg_amount<0.10 then 15 when avg_amount>0 and amount_variance/avg_amount<0.25 then 8 else 0 end))::int,true,now()
  from shaped where cadence<>'irregular'
  on conflict (business_unit_id,merchant_key,direction) do update set label=excluded.label,avg_amount=excluded.avg_amount,amount_variance=excluded.amount_variance,cadence=excluded.cadence,interval_days=excluded.interval_days,occurrence_count=excluded.occurrence_count,last_seen_date=excluded.last_seen_date,next_expected_date=excluded.next_expected_date,confidence=excluded.confidence,active=true,updated_at=now();
end; $$;
revoke all on function private.refresh_finance_recurring_patterns(uuid) from public,anon,authenticated;

create or replace function private.refresh_finance_reconciliation(p_business_unit_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.finance_reconciliations where business_unit_id=p_business_unit_id and status='suggested';

  insert into public.finance_reconciliations (business_unit_id,bank_transaction_id,match_type,matched_id,match_label,expected_amount,actual_amount,confidence,reason)
  select t.business_unit_id,t.id,'payroll_entry',e.id,'Payroll · '||e.staff_name_snapshot,e.take_home,t.amount,
    least(100,65+greatest(0,20-(abs(t.transaction_date-coalesce(r.week_end,r.week_start))*2))+case when lower(t.description) like '%'||lower(split_part(e.staff_name_snapshot,' ',1))||'%' then 10 else 0 end)::int,
    jsonb_build_object('payroll_run_id',r.id,'date_difference_days',abs(t.transaction_date-coalesce(r.week_end,r.week_start)),'amount_difference',abs(t.amount-e.take_home))
  from public.finance_transactions t join public.payroll_runs r on r.business_unit_id=t.business_unit_id and r.status='locked' join public.payroll_entries e on e.payroll_run_id=r.id
  where t.business_unit_id=p_business_unit_id and t.source='csv' and t.direction='expense' and abs(t.transaction_date-coalesce(r.week_end,r.week_start))<=14 and abs(t.amount-e.take_home)<=greatest(2,e.take_home*0.012)
  on conflict (bank_transaction_id,match_type,matched_id) do update set match_label=excluded.match_label,expected_amount=excluded.expected_amount,actual_amount=excluded.actual_amount,confidence=excluded.confidence,reason=excluded.reason,updated_at=now();

  insert into public.finance_reconciliations (business_unit_id,bank_transaction_id,match_type,matched_id,match_label,expected_amount,actual_amount,confidence,reason)
  select t.business_unit_id,t.id,'payroll_run',r.id,'Payroll run · '||coalesce(r.week_label,r.week_start::text),r.total_staff_payout,t.amount,
    least(98,70+greatest(0,20-(abs(t.transaction_date-coalesce(r.week_end,r.week_start))*2)))::int,
    jsonb_build_object('date_difference_days',abs(t.transaction_date-coalesce(r.week_end,r.week_start)),'amount_difference',abs(t.amount-r.total_staff_payout))
  from public.finance_transactions t join public.payroll_runs r on r.business_unit_id=t.business_unit_id and r.status='locked'
  where t.business_unit_id=p_business_unit_id and t.source='csv' and t.direction='expense' and abs(t.transaction_date-coalesce(r.week_end,r.week_start))<=10 and abs(t.amount-r.total_staff_payout)<=greatest(3,r.total_staff_payout*0.01)
  on conflict (bank_transaction_id,match_type,matched_id) do update set match_label=excluded.match_label,expected_amount=excluded.expected_amount,actual_amount=excluded.actual_amount,confidence=excluded.confidence,reason=excluded.reason,updated_at=now();

  insert into public.finance_reconciliations (business_unit_id,bank_transaction_id,match_type,matched_id,match_label,expected_amount,actual_amount,confidence,reason)
  select t.business_unit_id,t.id,'obligation',o.id,'Recurring · '||o.name,o.amount,t.amount,
    least(95,60+greatest(0,20-(abs(extract(day from t.transaction_date)::int-o.due_day)*2))+case when lower(t.description) like '%'||lower(split_part(o.name,' ',1))||'%' then 10 else 0 end)::int,
    jsonb_build_object('due_day_difference',abs(extract(day from t.transaction_date)::int-o.due_day),'amount_difference',abs(t.amount-o.amount))
  from public.finance_transactions t join public.finance_obligations o on o.business_unit_id=t.business_unit_id and o.status='active'
  where t.business_unit_id=p_business_unit_id and t.source='csv' and t.direction='expense' and abs(extract(day from t.transaction_date)::int-o.due_day)<=7 and abs(t.amount-o.amount)<=greatest(3,o.amount*0.03)
  on conflict (bank_transaction_id,match_type,matched_id) do update set match_label=excluded.match_label,expected_amount=excluded.expected_amount,actual_amount=excluded.actual_amount,confidence=excluded.confidence,reason=excluded.reason,updated_at=now();

  with sq as (
    select business_unit_id,transaction_date,sum(amount) amount,(array_agg(id))[1] id from public.finance_transactions where business_unit_id=p_business_unit_id and source='square' group by business_unit_id,transaction_date
  )
  insert into public.finance_reconciliations (business_unit_id,bank_transaction_id,match_type,matched_id,match_label,expected_amount,actual_amount,confidence,reason)
  select t.business_unit_id,t.id,'square_deposit',s.id,'Square sales · '||s.transaction_date,s.amount,t.amount,
    least(95,55+greatest(0,20-(abs(t.transaction_date-s.transaction_date)*4))+greatest(0,20-round((abs(t.amount-s.amount)/greatest(s.amount,1))*150)::int))::int,
    jsonb_build_object('sale_date',s.transaction_date,'date_difference_days',abs(t.transaction_date-s.transaction_date),'amount_difference',abs(t.amount-s.amount))
  from public.finance_transactions t join sq s on s.business_unit_id=t.business_unit_id
  where t.business_unit_id=p_business_unit_id and t.source='csv' and t.direction='income' and abs(t.transaction_date-s.transaction_date)<=4 and abs(t.amount-s.amount)<=greatest(5,s.amount*0.12)
  on conflict (bank_transaction_id,match_type,matched_id) do update set match_label=excluded.match_label,expected_amount=excluded.expected_amount,actual_amount=excluded.actual_amount,confidence=excluded.confidence,reason=excluded.reason,updated_at=now();
end; $$;
revoke all on function private.refresh_finance_reconciliation(uuid) from public,anon,authenticated;

create or replace function private.finance_bank_batch_refresh_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_business uuid;
begin
  for v_business in select distinct business_unit_id from new_rows where source='csv' loop
    perform private.refresh_finance_recurring_patterns(v_business);
    perform private.refresh_finance_reconciliation(v_business);
    perform private.refresh_finance_calendar_forecast(v_business);
  end loop;
  return null;
end; $$;
revoke all on function private.finance_bank_batch_refresh_trigger() from public,anon,authenticated;
drop trigger if exists finance_bank_batch_intelligence on public.finance_transactions;
create trigger finance_bank_batch_intelligence after insert on public.finance_transactions referencing new table as new_rows for each statement execute function private.finance_bank_batch_refresh_trigger();

create or replace function private.finance_source_refresh_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin if new.source in ('square','payroll') then perform private.refresh_finance_calendar_forecast(new.business_unit_id); end if; return new; end; $$;
revoke all on function private.finance_source_refresh_trigger() from public,anon,authenticated;
drop trigger if exists finance_auto_forecast_on_source on public.finance_transactions;
create trigger finance_auto_forecast_on_source after insert or update of amount,transaction_date on public.finance_transactions for each row execute function private.finance_source_refresh_trigger();

create or replace function private.finance_obligation_refresh_trigger() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform private.refresh_finance_calendar_forecast(coalesce(new.business_unit_id,old.business_unit_id)); return coalesce(new,old); end; $$;
revoke all on function private.finance_obligation_refresh_trigger() from public,anon,authenticated;
drop trigger if exists finance_auto_forecast_on_obligation on public.finance_obligations;
create trigger finance_auto_forecast_on_obligation after insert or update or delete on public.finance_obligations for each row execute function private.finance_obligation_refresh_trigger();
drop trigger if exists finance_auto_forecast_on_pattern on public.finance_recurring_patterns;
create trigger finance_auto_forecast_on_pattern after insert or update or delete on public.finance_recurring_patterns for each row execute function private.finance_obligation_refresh_trigger();

delete from public.finance_recurring_patterns where direction='income';
delete from public.finance_calendar_events where source_type='recurring_pattern' and direction='income';
