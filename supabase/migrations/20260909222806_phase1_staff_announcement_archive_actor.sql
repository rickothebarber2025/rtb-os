begin;

alter table public.staff_announcements
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists staff_announcements_active_business_idx
  on public.staff_announcements (business_unit_id, pinned desc, created_at desc)
  where archived_at is null;

create or replace function private.set_staff_announcement_archive_actor()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    new.archived_by := coalesce(new.archived_by, (select auth.uid()));
  end if;

  if old.archived_at is not null and new.archived_at is null then
    new.archived_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_staff_announcement_archive_actor on public.staff_announcements;
create trigger set_staff_announcement_archive_actor
before update on public.staff_announcements
for each row execute function private.set_staff_announcement_archive_actor();

drop policy if exists staff_announcements_select on public.staff_announcements;
create policy staff_announcements_select on public.staff_announcements
for select to authenticated
using (
  archived_at is null
  and private.staff_hub_business_view(business_unit_id)
);

drop policy if exists staff_announcements_update on public.staff_announcements;
create policy staff_announcements_update on public.staff_announcements
for update to authenticated
using (
  private.is_app_admin()
  or private.staff_hub_business_admin(business_unit_id, 'edit')
  or created_by = (select auth.uid())
)
with check (
  private.is_app_admin()
  or private.staff_hub_business_admin(business_unit_id, 'edit')
  or created_by = (select auth.uid())
);

comment on column public.staff_announcements.archived_at
  is 'Soft-delete timestamp for staff communication updates. Archived records stay in the database for audit history.';
comment on column public.staff_announcements.archived_by
  is 'Authenticated user who archived the staff communication update.';

commit;
