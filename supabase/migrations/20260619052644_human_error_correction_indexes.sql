begin;

create index if not exists payroll_runs_voided_by_idx
on public.payroll_runs(voided_by);

commit;
