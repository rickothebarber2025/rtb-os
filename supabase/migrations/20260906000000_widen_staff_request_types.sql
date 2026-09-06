-- Widen staff_operations_requests.request_type so the unified Message Center
-- can file what staff actually send, instead of forcing every request into
-- maintenance / inventory / incident.
--
-- The frontend already works without this (it keeps request_type valid and
-- puts the real intent in `category`). Applying this lets request_type carry
-- the intent directly and makes owner-side filtering cleaner.

alter table public.staff_operations_requests
  drop constraint if exists staff_operations_requests_request_type_check;

alter table public.staff_operations_requests
  add constraint staff_operations_requests_request_type_check
  check (request_type in (
    'maintenance',
    'inventory',
    'incident',
    'attendance',
    'schedule',
    'pay',
    'client',
    'question'
  ));

-- Backfill: promote intents already recorded in `category` into request_type
-- where they are more specific than the old three-way split.
update public.staff_operations_requests
   set request_type = case category
     when 'attendance_late'     then 'attendance'
     when 'attendance_absent'   then 'attendance'
     when 'availability_change' then 'schedule'
     when 'commission_pay'      then 'pay'
     when 'client_issue'        then 'client'
     when 'question'            then 'question'
     when 'supplies'            then 'inventory'
     when 'maintenance'         then 'maintenance'
     else request_type end
 where category in ('attendance_late','attendance_absent','availability_change','commission_pay','client_issue','question','supplies','maintenance');

-- Index the combination the owner inbox sorts on.
create index if not exists staff_operations_requests_open_priority_idx
  on public.staff_operations_requests (status, priority, created_at desc)
  where status not in ('completed','resolved','cancelled');
