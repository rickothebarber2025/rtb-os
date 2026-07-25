-- Matches the actual query pattern used by the Customer Intelligence
-- page (filter by business_id, order by created_at desc, limit 150).
-- Table is empty today (0 rows) so this has no measurable effect
-- yet, but costs nothing to add now and avoids a future migration
-- once real feedback data starts flowing.
create index if not exists feedback_requests_business_created_idx
  on public.feedback_requests (business_id, created_at desc);;
