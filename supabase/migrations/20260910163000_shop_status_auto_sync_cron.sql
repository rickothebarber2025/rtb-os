-- Schedules the shop-status-auto-sync edge function every 15 minutes.
-- The function reads Square order activity for both locations plus the
-- open_hours in shop_presence_settings, and writes into shop_status_events
-- (the same table staff checklist completion writes into) whenever the
-- computed status changes, or at least every 3 hours as a freshness floor.
-- This closes the gap where a location with no checklist activity for a
-- few days showed "Not set" on the Command Center.
--
-- Matches the same x-rtb-worker-token pattern already used by
-- daily-square-attendance-sync / daily-square-appointments-sync /
-- daily-square-sales-sync (RTB_SYNC_WORKER_TOKEN secret, checked inside the
-- function itself).
--
-- NOTE: this migration documents a change already applied directly to the
-- live database via the Supabase MCP (Claude session 2026-09-10).
-- Re-applying it is a no-op: cron.schedule() with an existing jobname just
-- updates that job in place.

begin;

select cron.schedule(
  'rtb-shop-status-auto-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://qbeficojfoqgzjxrzxyg.supabase.co/functions/v1/shop-status-auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-rtb-worker-token', '7nmG5QN85sWe5lQcqTcru5nYff2BoFr3y_PlPbYLAA0'
    ),
    body := '{}'::jsonb
  );
  $$
);

commit;
