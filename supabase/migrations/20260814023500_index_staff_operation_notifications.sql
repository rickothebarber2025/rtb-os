create index if not exists staff_operation_notifications_staff_created_idx
  on public.staff_operation_notifications(staff_id, created_at desc);

create index if not exists staff_operation_notifications_business_created_idx
  on public.staff_operation_notifications(business_unit_id, created_at desc);
