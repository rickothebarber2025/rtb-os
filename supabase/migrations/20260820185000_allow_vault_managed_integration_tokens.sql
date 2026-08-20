alter table public.integration_connections
  alter column access_token drop not null;

comment on column public.integration_connections.access_token is
  'Legacy direct-token storage. New OAuth integrations store secrets in the integration credential vault and may leave this column null.';
