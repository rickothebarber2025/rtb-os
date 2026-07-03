begin;

-- These older policies were equivalent module/business checks left behind by
-- earlier hardening work. Drop them so payroll_records has one clear policy set.
drop policy if exists payroll_records_read on public.payroll_records;
drop policy if exists payroll_records_insert on public.payroll_records;
drop policy if exists payroll_records_update on public.payroll_records;
drop policy if exists payroll_records_delete on public.payroll_records;

commit;
