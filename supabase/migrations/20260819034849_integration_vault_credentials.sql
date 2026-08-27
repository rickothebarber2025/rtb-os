create table if not exists public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  business_unit_id uuid references public.business_units(id) on delete cascade,
  credential_key text not null,
  vault_secret_id uuid not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, business_unit_id, credential_key)
);

alter table public.integration_credentials enable row level security;
revoke all on public.integration_credentials from anon, authenticated;
grant all on public.integration_credentials to service_role;

create or replace function public.store_integration_credential(
  p_provider text,
  p_business_unit_id uuid,
  p_credential_key text,
  p_secret text
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_id uuid;
  new_id uuid;
  secret_name text;
begin
  if coalesce(trim(p_provider),'') = '' or coalesce(trim(p_credential_key),'') = '' or coalesce(p_secret,'') = '' then
    raise exception 'Provider, credential key, and secret are required.';
  end if;

  select vault_secret_id into existing_id
  from public.integration_credentials
  where provider = lower(trim(p_provider))
    and credential_key = trim(p_credential_key)
    and business_unit_id is not distinct from p_business_unit_id
  limit 1;

  secret_name := 'rtb_os_' || lower(regexp_replace(trim(p_provider), '[^a-zA-Z0-9]+', '_', 'g')) || '_' ||
    lower(regexp_replace(trim(p_credential_key), '[^a-zA-Z0-9]+', '_', 'g')) || '_' ||
    coalesce(p_business_unit_id::text, 'global');

  if existing_id is not null then
    perform vault.update_secret(existing_id, p_secret, secret_name, 'RTB OS integration credential', null);
    update public.integration_credentials set updated_at = now() where vault_secret_id = existing_id;
  else
    new_id := vault.create_secret(p_secret, secret_name, 'RTB OS integration credential', null);
    insert into public.integration_credentials(provider,business_unit_id,credential_key,vault_secret_id)
    values(lower(trim(p_provider)),p_business_unit_id,trim(p_credential_key),new_id);
  end if;
end;
$$;

create or replace function public.get_integration_credential(
  p_provider text,
  p_business_unit_id uuid,
  p_credential_key text
) returns text
language sql
security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret
  from public.integration_credentials ic
  join vault.decrypted_secrets ds on ds.id = ic.vault_secret_id
  where ic.provider = lower(trim(p_provider))
    and ic.credential_key = trim(p_credential_key)
    and ic.business_unit_id is not distinct from p_business_unit_id
  limit 1;
$$;

revoke all on function public.store_integration_credential(text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.get_integration_credential(text,uuid,text) from public, anon, authenticated;
grant execute on function public.store_integration_credential(text,uuid,text,text) to service_role;
grant execute on function public.get_integration_credential(text,uuid,text) to service_role;
