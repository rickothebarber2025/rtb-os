begin;

alter table public.staff_announcements
  alter column created_by set default auth.uid();

update public.staff_announcements
set created_by = coalesce(created_by, auth.uid())
where false;

commit;
