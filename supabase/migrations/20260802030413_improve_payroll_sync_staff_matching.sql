begin;

-- Payroll rows from Google Sheets often use names from Square/Booksy/payroll
-- workbooks instead of the exact roster full_name. Resolve those rows to the
-- existing staff record before payroll_records/payroll_entries are written.

create or replace function private.payroll_staff_match_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '', 'g');
$function$;

create or replace function private.payroll_staff_has_business(
  p_staff_id uuid,
  p_staff_business_unit_id uuid,
  p_business_location text,
  p_target_business_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    p_staff_business_unit_id = p_target_business_unit_id
    or lower(coalesce(p_business_location, '')) = 'all businesses'
    or exists (
      select 1
      from public.app_settings settings
      cross join lateral jsonb_array_elements_text(
        coalesce(settings.value -> (p_staff_id::text) -> 'assigned_business_ids', '[]'::jsonb)
      ) assigned(business_unit_id)
      where settings.key = 'staff_business_metadata'
        and assigned.business_unit_id = p_target_business_unit_id::text
    );
$function$;

create or replace function private.match_payroll_staff_id(
  p_business_unit_id uuid,
  p_staff_name text,
  p_raw_row jsonb
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  matched_staff_id uuid;
  staff_email text := lower(btrim(coalesce(
    nullif(p_raw_row ->> 'staff_email', ''),
    nullif(p_raw_row ->> 'employee_email', ''),
    nullif(p_raw_row ->> 'team_member_email', ''),
    nullif(p_raw_row ->> 'email', '')
  )));
  staff_id_text text := btrim(coalesce(
    nullif(p_raw_row ->> 'staff_id', ''),
    nullif(p_raw_row ->> 'rtb_staff_id', '')
  ));
  source_staff_id text := btrim(coalesce(
    nullif(p_raw_row ->> 'source_staff_id', ''),
    nullif(p_raw_row ->> 'square_staff_id', ''),
    nullif(p_raw_row ->> 'booksy_staff_id', ''),
    nullif(p_raw_row ->> 'team_member_id', ''),
    nullif(p_raw_row ->> 'employee_id', ''),
    nullif(p_raw_row ->> 'provider_id', '')
  ));
  staff_name_key text := private.payroll_staff_match_key(p_staff_name);
begin
  if p_business_unit_id is null then
    return null;
  end if;

  if staff_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select s.id
    into matched_staff_id
    from public.staff s
    where s.id = staff_id_text::uuid
      and s.active
      and private.payroll_staff_has_business(
        s.id,
        s.business_unit_id,
        s.business_location,
        p_business_unit_id
      )
    limit 1;

    if matched_staff_id is not null then
      return matched_staff_id;
    end if;
  end if;

  if staff_email <> '' then
    select s.id
    into matched_staff_id
    from public.staff s
    where s.active
      and private.payroll_staff_has_business(
        s.id,
        s.business_unit_id,
        s.business_location,
        p_business_unit_id
      )
      and lower(btrim(coalesce(s.email, ''))) = staff_email
    order by
      case when s.business_unit_id = p_business_unit_id then 0 else 1 end,
      s.updated_at desc nulls last,
      s.created_at desc nulls last
    limit 1;

    if matched_staff_id is not null then
      return matched_staff_id;
    end if;

    select s.id
    into matched_staff_id
    from public.staff_source_identities ident
    join public.staff s on s.id = ident.staff_id
    where s.active
      and (
        ident.business_unit_id = p_business_unit_id
        or private.payroll_staff_has_business(
          s.id,
          s.business_unit_id,
          s.business_location,
          p_business_unit_id
        )
      )
      and lower(btrim(coalesce(ident.source_email, ''))) = staff_email
    order by
      case when ident.business_unit_id = p_business_unit_id then 0 else 1 end,
      ident.updated_at desc nulls last,
      ident.created_at desc nulls last
    limit 1;

    if matched_staff_id is not null then
      return matched_staff_id;
    end if;
  end if;

  if source_staff_id <> '' then
    select s.id
    into matched_staff_id
    from public.staff_source_identities ident
    join public.staff s on s.id = ident.staff_id
    where s.active
      and (
        ident.business_unit_id = p_business_unit_id
        or private.payroll_staff_has_business(
          s.id,
          s.business_unit_id,
          s.business_location,
          p_business_unit_id
        )
      )
      and ident.source_staff_id = source_staff_id
    order by
      case when ident.business_unit_id = p_business_unit_id then 0 else 1 end,
      ident.updated_at desc nulls last,
      ident.created_at desc nulls last
    limit 1;

    if matched_staff_id is not null then
      return matched_staff_id;
    end if;
  end if;

  if staff_name_key = '' then
    return null;
  end if;

  select candidate.id
  into matched_staff_id
  from (
    select
      s.id,
      s.business_unit_id,
      s.updated_at,
      s.created_at,
      10 as priority
    from public.staff s
    where s.active
      and private.payroll_staff_has_business(
        s.id,
        s.business_unit_id,
        s.business_location,
        p_business_unit_id
      )
      and private.payroll_staff_match_key(s.full_name) = staff_name_key

    union all

    select
      s.id,
      s.business_unit_id,
      s.updated_at,
      s.created_at,
      20 as priority
    from public.staff s
    where s.active
      and private.payroll_staff_has_business(
        s.id,
        s.business_unit_id,
        s.business_location,
        p_business_unit_id
      )
      and private.payroll_staff_match_key(s.preferred_name) = staff_name_key

    union all

    select
      s.id,
      s.business_unit_id,
      s.updated_at,
      s.created_at,
      30 as priority
    from public.staff s
    where s.active
      and private.payroll_staff_has_business(
        s.id,
        s.business_unit_id,
        s.business_location,
        p_business_unit_id
      )
      and private.payroll_staff_match_key(s.social_handle) = staff_name_key

    union all

    select
      s.id,
      s.business_unit_id,
      s.updated_at,
      s.created_at,
      40 as priority
    from public.staff_aliases alias
    join public.staff s on s.id = alias.staff_id
    where s.active
      and (
        alias.business_unit_id = p_business_unit_id
        or private.payroll_staff_has_business(
          s.id,
          s.business_unit_id,
          s.business_location,
          p_business_unit_id
        )
      )
      and alias.alias_key = staff_name_key

    union all

    select
      s.id,
      s.business_unit_id,
      s.updated_at,
      s.created_at,
      50 as priority
    from public.staff_source_identities ident
    join public.staff s on s.id = ident.staff_id
    where s.active
      and (
        ident.business_unit_id = p_business_unit_id
        or private.payroll_staff_has_business(
          s.id,
          s.business_unit_id,
          s.business_location,
          p_business_unit_id
        )
      )
      and (
        private.payroll_staff_match_key(ident.source_display_name) = staff_name_key
        or private.payroll_staff_match_key(ident.preferred_name) = staff_name_key
      )
  ) candidate
  order by
    candidate.priority,
    case when candidate.business_unit_id = p_business_unit_id then 0 else 1 end,
    candidate.updated_at desc nulls last,
    candidate.created_at desc nulls last
  limit 1;

  return matched_staff_id;
end;
$function$;

do $migration$
declare
  fn text;
  original_fn text;
begin
  select pg_get_functiondef('public.sync_google_sheets_payroll(jsonb)'::regprocedure)
  into fn;

  if fn not like '%private.match_payroll_staff_id%' then
    original_fn := fn;
    fn := regexp_replace(
      fn,
      'select s\.\*\s+into staff_record\s+from public\.staff s\s+where s\.business_unit_id = business_record\.id\s+and lower\(btrim\(s\.full_name\)\) = lower\(staff_name_value\)\s+order by s\.active desc, s\.updated_at desc nulls last, s\.created_at desc nulls last\s+limit 1;',
      $new$
      select s.*
      into staff_record
      from public.staff s
      where s.id = private.match_payroll_staff_id(
        business_record.id,
        staff_name_value,
        raw_row
      )
      limit 1;
      $new$,
      'm'
    );

    if fn = original_fn then
      raise exception 'Expected staff matching block not found in public.sync_google_sheets_payroll.';
    end if;

    execute fn;
  end if;
end;
$migration$;

revoke all on function private.payroll_staff_match_key(text)
from public, anon, authenticated;

revoke all on function private.payroll_staff_has_business(uuid, uuid, text, uuid)
from public, anon, authenticated;

revoke all on function private.match_payroll_staff_id(uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function private.payroll_staff_has_business(uuid, uuid, text, uuid)
to service_role;

grant execute on function private.match_payroll_staff_id(uuid, text, jsonb)
to service_role;

revoke all on function public.sync_google_sheets_payroll(jsonb)
from public, anon, authenticated;

grant execute on function public.sync_google_sheets_payroll(jsonb)
to service_role;

commit;
