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

drop policy if exists finance_transactions_select on public.finance_transactions;
create policy finance_transactions_select on public.finance_transactions
for select to authenticated
using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view'));

drop policy if exists finance_transactions_insert on public.finance_transactions;
create policy finance_transactions_insert on public.finance_transactions
for insert to authenticated
with check (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit'));

drop policy if exists finance_transactions_update on public.finance_transactions;
create policy finance_transactions_update on public.finance_transactions
for update to authenticated
using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit'))
with check (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit'));

drop policy if exists finance_transactions_delete on public.finance_transactions;
create policy finance_transactions_delete on public.finance_transactions
for delete to authenticated
using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('admin'));

drop policy if exists finance_obligations_select on public.finance_obligations;
create policy finance_obligations_select on public.finance_obligations
for select to authenticated
using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view'));

drop policy if exists finance_obligations_insert on public.finance_obligations;
create policy finance_obligations_insert on public.finance_obligations
for insert to authenticated
with check (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit'));

drop policy if exists finance_obligations_update on public.finance_obligations;
create policy finance_obligations_update on public.finance_obligations
for update to authenticated
using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit'))
with check (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit'));

drop policy if exists finance_obligations_delete on public.finance_obligations;
create policy finance_obligations_delete on public.finance_obligations
for delete to authenticated
using (private.permission_rank(private.module_permission('finance')) >= private.permission_rank('admin'));

commit;
