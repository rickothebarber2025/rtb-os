begin;

create table if not exists public.finance_import_runs (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  file_name text not null,
  imported_count integer not null default 0,
  rejected_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists finance_import_runs_business_created_idx
  on public.finance_import_runs (business_unit_id, created_at desc);
create index if not exists finance_import_runs_created_by_idx
  on public.finance_import_runs (created_by);

alter table public.finance_import_runs enable row level security;

drop policy if exists finance_import_runs_select on public.finance_import_runs;
create policy finance_import_runs_select on public.finance_import_runs
for select to authenticated
using (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('view')
  and private.finance_business_allowed(business_unit_id)
);

drop policy if exists finance_import_runs_insert on public.finance_import_runs;
create policy finance_import_runs_insert on public.finance_import_runs
for insert to authenticated
with check (
  private.permission_rank(private.module_permission('finance')) >= private.permission_rank('edit')
  and private.finance_business_allowed(business_unit_id)
);

commit;
