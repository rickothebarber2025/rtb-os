alter table public.finance_payment_confirmations add column if not exists direction text not null default 'expense' check(direction in ('income','expense'));
alter table public.finance_payment_confirmations add column if not exists counterparty_type text not null default 'unknown' check(counterparty_type in ('staff','vendor','customer','owner','unknown'));
alter table public.finance_payment_confirmations add column if not exists routing_method text;
create index if not exists finance_payment_confirmations_direction_idx on public.finance_payment_confirmations(business_unit_id,direction,deposited_at desc);

create or replace function public.refresh_finance_payment_evidence(p_business_unit_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_confirmed int:=0; v_suggested int:=0;
begin
  with bank_candidates as (
    select c.id confirmation_id,ft.id bank_transaction_id,abs(ft.transaction_date-c.deposited_at::date) dd,row_number() over(partition by c.id order by abs(ft.transaction_date-c.deposited_at::date),ft.transaction_date,ft.id) rn
    from public.finance_payment_confirmations c join public.finance_transactions ft on ft.business_unit_id=c.business_unit_id and ft.source='csv' and ft.direction=c.direction and abs(ft.amount-c.amount)<=0.02 and c.deposited_at is not null and abs(ft.transaction_date-c.deposited_at::date)<=5
    where c.business_unit_id=p_business_unit_id and c.bank_transaction_id is null
  ) update public.finance_payment_confirmations c set bank_transaction_id=b.bank_transaction_id,updated_at=now(),evidence=coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('bank_amount_exact',true,'bank_date_difference_days',b.dd) from bank_candidates b where b.confirmation_id=c.id and b.rn=1;

  with payroll_candidates as (
    select c.id confirmation_id,pe.id entry_id,pr.id run_id,row_number() over(partition by c.id order by case when c.deposited_at is null then 999 else abs(c.deposited_at::date-coalesce(pr.week_end,pr.week_start)) end,pe.id) rn
    from public.finance_payment_confirmations c join public.payroll_entries pe on pe.staff_id=c.staff_id and abs(pe.take_home-c.amount)<=0.02 join public.payroll_runs pr on pr.id=pe.payroll_run_id and pr.business_unit_id=c.business_unit_id and pr.status='locked'
    where c.business_unit_id=p_business_unit_id and c.direction='expense' and c.staff_id is not null and (c.deposited_at is null or abs(c.deposited_at::date-coalesce(pr.week_end,pr.week_start))<=14)
  ) update public.finance_payment_confirmations c set payroll_entry_id=p.entry_id,payroll_run_id=p.run_id,match_confidence=case when c.bank_transaction_id is not null then 100 else 88 end,match_status=case when c.bank_transaction_id is not null then 'confirmed' else 'suggested' end,payment_kind='payroll',category_hint='Payroll',counterparty_type='staff',evidence=coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('payroll_amount_exact',true,'payroll_staff_match',true,'three_way_verified',c.bank_transaction_id is not null),updated_at=now() from payroll_candidates p where p.confirmation_id=c.id and p.rn=1;

  update public.finance_payment_confirmations c set match_confidence=case when c.direction='income' then 92 else 90 end,match_status='suggested',payment_kind=case when c.direction='income' then 'interac_income' when c.payment_kind='unknown' then 'bank_verified_transfer' else c.payment_kind end,category_hint=case when c.direction='income' then coalesce(c.category_hint,'Interac income') else coalesce(c.category_hint,'Outgoing transfer') end,evidence=coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('email_bank_verified',true),updated_at=now() where c.business_unit_id=p_business_unit_id and c.bank_transaction_id is not null and c.payroll_entry_id is null and c.match_status not in('confirmed','ignored');
  update public.finance_payment_confirmations c set match_confidence=80,match_status='suggested',evidence=coalesce(c.evidence,'{}'::jsonb)||jsonb_build_object('email_payroll_evidence',true,'awaiting_bank_statement',true),updated_at=now() where c.business_unit_id=p_business_unit_id and c.direction='expense' and c.staff_id is not null and c.payroll_entry_id is null and c.bank_transaction_id is null and c.match_status='unmatched';

  insert into public.finance_reconciliations(business_unit_id,bank_transaction_id,match_type,matched_id,match_label,expected_amount,actual_amount,confidence,status,reason)
  select c.business_unit_id,c.bank_transaction_id,'payroll_entry',c.payroll_entry_id,'Email + bank verified payroll · '||c.recipient_name,pe.take_home,c.amount,c.match_confidence,case when c.match_status='confirmed' then 'confirmed' else 'suggested' end,jsonb_build_object('source','interac_email','gmail_confirmation_id',c.id,'recipient',c.recipient_name,'direction',c.direction,'three_way_verified',coalesce((c.evidence->>'three_way_verified')::boolean,false))
  from public.finance_payment_confirmations c join public.payroll_entries pe on pe.id=c.payroll_entry_id where c.business_unit_id=p_business_unit_id and c.bank_transaction_id is not null and c.payroll_entry_id is not null
  on conflict(bank_transaction_id,match_type,matched_id) do update set confidence=greatest(public.finance_reconciliations.confidence,excluded.confidence),status=case when excluded.status='confirmed' then 'confirmed' else public.finance_reconciliations.status end,match_label=excluded.match_label,reason=coalesce(public.finance_reconciliations.reason,'{}'::jsonb)||excluded.reason,updated_at=now();

  insert into public.finance_reconciliations(business_unit_id,bank_transaction_id,match_type,matched_id,match_label,expected_amount,actual_amount,confidence,status,reason)
  select c.business_unit_id,c.bank_transaction_id,'other',c.id,case when c.direction='income' then 'Email verified income · ' else 'Email verified transfer · ' end||c.recipient_name,c.amount,c.amount,c.match_confidence,'suggested',jsonb_build_object('source','interac_email','gmail_confirmation_id',c.id,'counterparty',c.recipient_name,'direction',c.direction,'counterparty_type',c.counterparty_type,'category_hint',c.category_hint)
  from public.finance_payment_confirmations c where c.business_unit_id=p_business_unit_id and c.bank_transaction_id is not null and c.payroll_entry_id is null and c.match_confidence>=85
  on conflict(bank_transaction_id,match_type,matched_id) do update set confidence=greatest(public.finance_reconciliations.confidence,excluded.confidence),match_label=excluded.match_label,reason=coalesce(public.finance_reconciliations.reason,'{}'::jsonb)||excluded.reason,updated_at=now();

  select count(*) into v_confirmed from public.finance_payment_confirmations where business_unit_id=p_business_unit_id and match_status='confirmed';
  select count(*) into v_suggested from public.finance_payment_confirmations where business_unit_id=p_business_unit_id and match_status='suggested';
  return jsonb_build_object('confirmed',v_confirmed,'suggested',v_suggested);
end; $$;
