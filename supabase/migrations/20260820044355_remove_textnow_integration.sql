-- TextNow was removed from RTB OS. Keep production and fresh databases free of its legacy tables.
drop table if exists public.textnow_outbox cascade;
drop table if exists public.textnow_messages cascade;
drop table if exists public.textnow_sync_state cascade;

delete from public.integration_connections where provider = 'textnow';
