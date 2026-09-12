set local search_path = public, private, pg_catalog;

revoke usage on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create temporary table _rtb_sd_targets on commit drop as
select
  p.oid,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_function_arguments(p.oid) as full_args,
  pg_get_function_result(p.oid) as result_type,
  p.proretset,
  p.pronargs,
  p.provolatile
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and not has_function_privilege('anon', p.oid, 'EXECUTE');

do $do$
declare
  r record;
  v_call_args text;
  v_body text;
  v_volatility text;
begin
  for r in
    select * from _rtb_sd_targets order by proname, identity_args
  loop
    select coalesce(string_agg(format('$%s', i), ', ' order by i), '')
      into v_call_args
    from generate_series(1, r.pronargs) as g(i);

    execute format(
      'alter function public.%I(%s) set schema private',
      r.proname,
      r.identity_args
    );

    execute format(
      'revoke all on function private.%I(%s) from public, anon',
      r.proname,
      r.identity_args
    );
    execute format(
      'grant execute on function private.%I(%s) to authenticated, service_role',
      r.proname,
      r.identity_args
    );

    v_volatility := case r.provolatile
      when 'i' then 'immutable'
      when 's' then 'stable'
      else 'volatile'
    end;

    if r.proretset then
      v_body := format('select * from private.%I(%s)', r.proname, v_call_args);
    else
      v_body := format('select private.%I(%s)', r.proname, v_call_args);
    end if;

    execute format(
      'create function public.%I(%s) returns %s language sql %s security invoker set search_path to pg_catalog, public, private as %L',
      r.proname,
      r.full_args,
      r.result_type,
      v_volatility,
      v_body
    );

    execute format(
      'revoke all on function public.%I(%s) from public, anon',
      r.proname,
      r.identity_args
    );
    execute format(
      'grant execute on function public.%I(%s) to authenticated, service_role',
      r.proname,
      r.identity_args
    );
  end loop;
end
$do$;
