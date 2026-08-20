alter table public.finance_payment_confirmations add column if not exists staff_id uuid references public.staff(id) on delete set null;
alter table public.finance_payment_confirmations add column if not exists obligation_id uuid references public.finance_obligations(id) on delete set null;
alter table public.finance_payment_confirmations add column if not exists payment_kind text not null default 'unknown';
alter table public.finance_payment_confirmations add column if not exists category_hint text;
create index if not exists finance_payment_confirmations_staff_idx on public.finance_payment_confirmations(staff_id,deposited_at desc);
create index if not exists finance_payment_confirmations_bank_idx on public.finance_payment_confirmations(bank_transaction_id);

create or replace function public.refresh_finance_payment_evidence(p_business_unit_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_confirmed int:=0; v_suggested int:=0;
begin
  with staff_candidates as (
    select c.id confirmation_id,st.id staff_id,row_number() over(partition by c.id order by case when lower(regexp_replace(st.full_name,'[^a-z0-9]+','','gi'))=lower(c.recipient_key) then 0 else 1 end,st.full_name) rn
    from public.finance_payment_confirmations c
    join public.staff st on st.business_unit_id=c.business_unit_id and st.active is not false
    left join public.staff_aliases sa on sa.staff_id=st.id
    where c.business_unit_id=p_business_unit_id and (c.staff_id is null or c.payment_kind='unknown') and (
      lower(regexp_replace(st.full_name,'[^a-z0-9]+','','gi'))=lower(c.recipient_key)
      or lower(regexp_replace(coalesce(st.preferred_name,''),'[^a-z0-9]+','','gi'))=lower(c.recipient_key)
      or lower(regexp_replace(coalesce(sa.alias,''),'[^a-z0-9]+','','gi'))=lower(c.recipient_key)
      or lower(regexp_replace(st.full_name,'[^a-z0-9]+','','gi')) like '%'||lower(c.recipient_key)||'%'
      or lower(c.recipient_key) like '%'||lower(regexp_replace(split_part(st.full_name,' ',1),'[^a-z0-9]+','','gi'))||'%'
    )
  ) update public.finance_payment_confirmations c set staff_id=sc.staff_id,payment_kind='payroll',category_hint='Payroll',updated_at=now() from staff_candidates sc where sc.confirmation_id=c.id and sc.rn=1;

  with bank_candidates as (
    select c.id confirmation_id,ft.id bank_transaction_id,abs(ft.transaction_date-c.deposited_at::date) dd,row_number() over(partition by c.id order by abs(ft.transaction_date-c.deposited_at::date),ft.transaction_date,ft.id) rn
    from public.finance_payment_confirmations c join public.finance_transactions ft on ft.business_unit_id=c.business_unit_id and ft.source='csv' and ft.direction='expense' and abs(ft.amount-c.amount)<=0.02 and c.deposited_at is not null and abs(ft.transaction_date-c.deposited_at::date)<=5
    where c.business_unit_id=p_business_unit_id and c.bank_transaction_id is null
  ) update public.finance_payment_confirmations c set bank_transaction_id=b.bank_transaction_id,updated_at=now(),evidence=coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('bank_amount_exact',true,'bank_date_difference_days',b.dd) from bank_candidates b where b.confirmation_id=c.id and b.rn=1;

  with payroll_candidates as (
    select c.id confirmation_id,pe.id entry_id,pr.id run_id,row_number() over(partition by c.id order by case when c.deposited_at is null then 999 else abs(c.deposited_at::date-coalesce(pr.week_end,pr.week_start)) end,pe.id) rn
    from public.finance_payment_confirmations c join public.payroll_entries pe on pe.staff_id=c.staff_id and abs(pe.take_home-c.amount)<=0.02 join public.payroll_runs pr on pr.id=pe.payroll_run_id and pr.business_unit_id=c.business_unit_id and pr.status='locked'
    where c.business_unit_id=p_business_unit_id and c.staff_id is not null and (c.deposited_at is null or abs(c.deposited_at::date-coalesce(pr.week_end,pr.week_start))<=14)
  ) update public.finance_payment_confirmations c set payroll_entry_id=p.entry_id,payroll_run_id=p.run_id,match_confidence=case when c.bank_transaction_id is not null then 100 else 88 end,match_status=case when c.bank_transaction_id is not null then 'confirmed' else 'suggested' end,payment_kind='payroll',category_hint='Payroll',evidence=coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('payroll_amount_exact',true,'payroll_staff_match',true,'three_way_verified',c.bank_transaction_id is not null),updated_at=now() from payroll_candidates p where p.confirmation_id=c.id and p.rn=1;

  update public.finance_payment_confirmations c set match_confidence=90,match_status='suggested',payment_kind=case when c.payment_kind='unknown' then 'bank_verified_transfer' else c.payment_kind end,category_hint=coalesce(c.category_hint,'Outgoing transfer'),evidence=coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('email_bank_verified',true),updated_at=now() where c.business_unit_id=p_business_unit_id and c.bank_transaction_id is not null and c.payroll_entry_id is null and c.match_status not in('confirmed','ignored');
  update public.finance_payment_confirmations c set match_confidence=80,match_status='suggested',evidence=coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('email_payroll_evidence',true,'awaiting_bank_statement',true),updated_at=now() where c.business_unit_id=p_business_unit_id and c.staff_id is not null and c.payroll_entry_id is null and c.bank_transaction_id is null and c.match_status='unmatched';

  insert into public.finance_reconciliations(business_unit_id,bank_transaction_id,match_type,matched_id,match_label,expected_amount,actual_amount,confidence,status,reason)
  select c.business_unit_id,c.bank_transaction_id,'payroll_entry',c.payroll_entry_id,'Email + bank verified payroll · '||c.recipient_name,pe.take_home,c.amount,c.match_confidence,case when c.match_status='confirmed' then 'confirmed' else 'suggested' end,jsonb_build_object('source','interac_email','gmail_confirmation_id',c.id,'recipient',c.recipient_name,'three_way_verified',coalesce((c.evidence->>'three_way_verified')::boolean,false))
  from public.finance_payment_confirmations c join public.payroll_entries pe on pe.id=c.payroll_entry_id where c.business_unit_id=p_business_unit_id and c.bank_transaction_id is not null and c.payroll_entry_id is not null
  on conflict(bank_transaction_id,match_type,matched_id) do update set confidence=greatest(public.finance_reconciliations.confidence,excluded.confidence),status=case when excluded.status='confirmed' then 'confirmed' else public.finance_reconciliations.status end,match_label=excluded.match_label,reason=coalesce(public.finance_reconciliations.reason,'{}'::jsonb)||excluded.reason,updated_at=now();

  insert into public.finance_reconciliations(business_unit_id,bank_transaction_id,match_type,matched_id,match_label,expected_amount,actual_amount,confidence,status,reason)
  select c.business_unit_id,c.bank_transaction_id,'other',c.id,'Email verified transfer · '||c.recipient_name,c.amount,c.amount,c.match_confidence,'suggested',jsonb_build_object('source','interac_email','gmail_confirmation_id',c.id,'recipient',c.recipient_name,'category_hint',c.category_hint)
  from public.finance_payment_confirmations c where c.business_unit_id=p_business_unit_id and c.bank_transaction_id is not null and c.payroll_entry_id is null and c.match_confidence>=85
  on conflict(bank_transaction_id,match_type,matched_id) do update set confidence=greatest(public.finance_reconciliations.confidence,excluded.confidence),match_label=excluded.match_label,reason=coalesce(public.finance_reconciliations.reason,'{}'::jsonb)||excluded.reason,updated_at=now();

  select count(*) into v_confirmed from public.finance_payment_confirmations where business_unit_id=p_business_unit_id and match_status='confirmed';
  select count(*) into v_suggested from public.finance_payment_confirmations where business_unit_id=p_business_unit_id and match_status='suggested';
  return jsonb_build_object('confirmed',v_confirmed,'suggested',v_suggested);
end; $$;
revoke all on function public.refresh_finance_payment_evidence(uuid) from public,anon,authenticated;
grant execute on function public.refresh_finance_payment_evidence(uuid) to service_role;

with ranked as (select id,row_number() over(partition by business_unit_id,horizon_days order by generated_at desc,id desc) rn from public.finance_forecast_snapshots)
delete from public.finance_forecast_snapshots f using ranked r where f.id=r.id and r.rn>1;

insert into public.app_settings(key,value)
select 'finance_gmail_cron_token',jsonb_build_object('token',encode(gen_random_bytes(32),'hex'))
where not exists(select 1 from public.app_settings where key='finance_gmail_cron_token');

do $$ begin if exists(select 1 from cron.job where jobname='rtb-finance-gmail-evidence-sync') then perform cron.unschedule('rtb-finance-gmail-evidence-sync'); end if; end $$;
select cron.schedule('rtb-finance-gmail-evidence-sync','*/30 * * * *',$$select net.http_post(url := 'https://qbeficojfoqgzjxrzxyg.supabase.co/functions/v1/gmail-payroll-sync',headers := jsonb_build_object('content-type','application/json','x-finance-cron-token',(select value->>'token' from public.app_settings where key='finance_gmail_cron_token')),body := case when c.business_unit_id is null then jsonb_build_object('maxMessages',250) else jsonb_build_object('maxMessages',250,'businessId',c.business_unit_id) end) from public.integration_connections c where c.provider='google' and c.status='connected';$$);
