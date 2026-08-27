create schema if not exists private;

create unique index if not exists finance_transactions_source_external_ref_uidx
on public.finance_transactions (business_unit_id, source, external_ref)
where external_ref is not null;

create or replace function private.sync_square_sale_to_finance()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.finance_transactions (business_unit_id,transaction_date,direction,amount,category,description,source,external_ref,notes)
  values (new.business_unit_id,new.sale_date,'income',coalesce(new.net_sales,0),'Sales revenue','Square sales' || case when new.square_team_member_id is not null then ' · team member '||new.square_team_member_id else '' end,'square','staff_daily_sales:'||new.id::text,'Automatically synchronized from RTB OS Square daily sales.')
  on conflict (business_unit_id,source,external_ref) where external_ref is not null
  do update set transaction_date=excluded.transaction_date,amount=excluded.amount,description=excluded.description,notes=excluded.notes,updated_at=now();
  return new;
end;
$$;

create or replace function private.sync_payroll_run_to_finance()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status='locked' then
    insert into public.finance_transactions (business_unit_id,transaction_date,direction,amount,category,description,source,external_ref,notes)
    values (new.business_unit_id,coalesce(new.week_end,new.week_start,current_date),'expense',coalesce(new.total_staff_payout,0),'Payroll','Staff payroll · '||coalesce(new.week_label,new.week_start::text),'payroll','payroll_run:'||new.id::text,'Automatically synchronized from a locked RTB OS payroll run.')
    on conflict (business_unit_id,source,external_ref) where external_ref is not null
    do update set transaction_date=excluded.transaction_date,amount=excluded.amount,description=excluded.description,notes=excluded.notes,updated_at=now();
  else
    delete from public.finance_transactions where business_unit_id=new.business_unit_id and source='payroll' and external_ref='payroll_run:'||new.id::text;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_square_sale_to_finance() from public,anon,authenticated;
revoke all on function private.sync_payroll_run_to_finance() from public,anon,authenticated;

do $square_trigger$
begin
  if to_regclass('public.staff_daily_sales') is not null then
    execute 'drop trigger if exists finance_sync_square_sale on public.staff_daily_sales';
    execute 'create trigger finance_sync_square_sale after insert or update of business_unit_id,sale_date,net_sales,square_team_member_id on public.staff_daily_sales for each row execute function private.sync_square_sale_to_finance()';
  end if;
end;
$square_trigger$;

drop trigger if exists finance_sync_payroll_run on public.payroll_runs;
create trigger finance_sync_payroll_run after insert or update of business_unit_id,week_start,week_end,week_label,status,total_staff_payout on public.payroll_runs for each row execute function private.sync_payroll_run_to_finance();

do $square_backfill$
begin
  if to_regclass('public.staff_daily_sales') is not null then
    execute $sql$
      insert into public.finance_transactions (
        business_unit_id,transaction_date,direction,amount,category,
        description,source,external_ref,notes
      )
      select
        s.business_unit_id,s.sale_date,'income',coalesce(s.net_sales,0),
        'Sales revenue',
        'Square sales'||case when s.square_team_member_id is not null
          then ' · team member '||s.square_team_member_id else '' end,
        'square','staff_daily_sales:'||s.id::text,
        'Automatically synchronized from RTB OS Square daily sales.'
      from public.staff_daily_sales s
      where coalesce(s.net_sales,0)>0
      on conflict (business_unit_id,source,external_ref)
        where external_ref is not null
      do update set
        transaction_date=excluded.transaction_date,
        amount=excluded.amount,
        description=excluded.description,
        notes=excluded.notes,
        updated_at=now()
    $sql$;
  end if;
end;
$square_backfill$;

insert into public.finance_transactions (business_unit_id,transaction_date,direction,amount,category,description,source,external_ref,notes)
select p.business_unit_id,coalesce(p.week_end,p.week_start,current_date),'expense',coalesce(p.total_staff_payout,0),'Payroll','Staff payroll · '||coalesce(p.week_label,p.week_start::text),'payroll','payroll_run:'||p.id::text,'Automatically synchronized from a locked RTB OS payroll run.'
from public.payroll_runs p where p.status='locked' and coalesce(p.total_staff_payout,0)>0
on conflict (business_unit_id,source,external_ref) where external_ref is not null do update set transaction_date=excluded.transaction_date,amount=excluded.amount,description=excluded.description,notes=excluded.notes,updated_at=now();