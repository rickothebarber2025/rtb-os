begin;

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  transaction_date date not null default current_date,
  direction text not null check (direction in ('income', 'expense')),
  amount numeric(12,2) not null check (amount > 0),
  category text not null default 'Uncategorized',
  description text not null,
  source text not null default 'manual' check (source in ('manual', 'csv', 'square', 'payroll', 'system')),
  external_ref text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_obligations (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  name text not null,
  amount numeric(12,2) not null check (amount > 0),
  due_day integer not null default 1 check (due_day between 1 and 31),
  frequency text not null default 'monthly' check (frequency in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'other')),
  category text not null default 'Operating expense',
  status text not null default 'active' check (status in ('active', 'paused')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_transactions_business_date_idx
  on public.finance_transactions (business_unit_id, transaction_date desc);
create index if not exists finance_transactions_category_idx
  on public.finance_transactions (business_unit_id, category);
create index if not exists finance_obligations_business_status_idx
  on public.finance_obligations (business_unit_id, status);

alter table public.finance_transactions enable row level security;
alter table public.finance_obligations enable row level security;

create or replace function private.finance_business_allowed(p_business_unit_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  current_profile public.user_profiles%rowtype;
  payload jsonb;
  business_ids jsonb;
begin
  select * into current_profile
  from public.user_profiles
  where id = (select auth.uid());

  if current_profile.id is null then
    return false;
  end if;

  if lower(coalesce(current_profile.email, '')) = 'rickothebarber@gmail.com'
     or lower(coalesce(current_profile.role, '')) = 'owner' then
    return true;
  end if;

  if current_profile.active is false then
    return false;
  end if;

  payload := coalesce(current_profile.permissions, '{}'::jsonb);
  if lower(coalesce(payload->>'business_scope', '')) = 'all' then
    return true;
  end if;

  business_ids := coalesce(payload->'business_unit_ids', '[]'::jsonb);
  if business_ids ? 'all-businesses' or business_ids ? p_business_unit_id::text then
    return true;
  end if;

  return current_profile.business_unit_id = p_business_unit_id;
end;
$function$;

drop policy if exists finance_transactions_select on public.finance_transactions;
create policy finance_transactions_select on public.finance_transactions
for select to authenticated
using (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view')
  and private.finance_business_allowed(business_unit_id)
);

drop policy if exists finance_transactions_insert on public.finance_transactions;
create policy finance_transactions_insert on public.finance_transactions
for insert to authenticated
with check (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit')
  and private.finance_business_allowed(business_unit_id)
);

drop policy if exists finance_transactions_update on public.finance_transactions;
create policy finance_transactions_update on public.finance_transactions
for update to authenticated
using (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit')
  and private.finance_business_allowed(business_unit_id)
)
with check (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit')
  and private.finance_business_allowed(business_unit_id)
);

drop policy if exists finance_transactions_delete on public.finance_transactions;
create policy finance_transactions_delete on public.finance_transactions
for delete to authenticated
using (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('admin')
  and private.finance_business_allowed(business_unit_id)
);

drop policy if exists finance_obligations_select on public.finance_obligations;
create policy finance_obligations_select on public.finance_obligations
for select to authenticated
using (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view')
  and private.finance_business_allowed(business_unit_id)
);

drop policy if exists finance_obligations_insert on public.finance_obligations;
create policy finance_obligations_insert on public.finance_obligations
for insert to authenticated
with check (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit')
  and private.finance_business_allowed(business_unit_id)
);

drop policy if exists finance_obligations_update on public.finance_obligations;
create policy finance_obligations_update on public.finance_obligations
for update to authenticated
using (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit')
  and private.finance_business_allowed(business_unit_id)
)
with check (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit')
  and private.finance_business_allowed(business_unit_id)
);

drop policy if exists finance_obligations_delete on public.finance_obligations;
create policy finance_obligations_delete on public.finance_obligations
for delete to authenticated
using (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('admin')
  and private.finance_business_allowed(business_unit_id)
);

commit;
