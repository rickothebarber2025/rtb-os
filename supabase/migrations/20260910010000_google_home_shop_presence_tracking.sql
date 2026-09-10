begin;

create table if not exists public.shop_presence_events (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid references public.business_units(id) on delete cascade,
  source text not null default 'google_home',
  device_name text,
  event_type text not null check (event_type in ('person','motion','door','manual')),
  occurred_at timestamptz not null,
  confidence numeric(5,2),
  external_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists shop_presence_events_external_event_uidx
  on public.shop_presence_events(source, external_event_id)
  where external_event_id is not null;

create index if not exists shop_presence_events_business_time_idx
  on public.shop_presence_events(business_unit_id, occurred_at desc);

create table if not exists public.shop_presence_settings (
  business_unit_id uuid primary key references public.business_units(id) on delete cascade,
  timezone text not null default 'America/Toronto',
  open_hours jsonb not null default '{}'::jsonb,
  opening_grace_minutes integer not null default 10 check (opening_grace_minutes between 0 and 120),
  closing_early_tolerance_minutes integer not null default 15 check (closing_early_tolerance_minutes between 0 and 180),
  closing_quiet_minutes integer not null default 30 check (closing_quiet_minutes between 5 and 180),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.shop_presence_events enable row level security;
alter table public.shop_presence_settings enable row level security;

drop policy if exists shop_presence_events_read on public.shop_presence_events;
create policy shop_presence_events_read
on public.shop_presence_events
for select to authenticated
using (
  business_unit_id is null
  or private.staff_hub_business_admin(business_unit_id, 'view')
  or private.is_app_admin()
);

drop policy if exists shop_presence_events_manage on public.shop_presence_events;
create policy shop_presence_events_manage
on public.shop_presence_events
for all to authenticated
using (
  private.is_app_admin()
  or (business_unit_id is not null and private.staff_hub_business_admin(business_unit_id, 'admin'))
)
with check (
  private.is_app_admin()
  or (business_unit_id is not null and private.staff_hub_business_admin(business_unit_id, 'admin'))
);

drop policy if exists shop_presence_settings_read on public.shop_presence_settings;
create policy shop_presence_settings_read
on public.shop_presence_settings
for select to authenticated
using (
  private.is_app_admin()
  or private.staff_hub_business_admin(business_unit_id, 'view')
);

drop policy if exists shop_presence_settings_manage on public.shop_presence_settings;
create policy shop_presence_settings_manage
on public.shop_presence_settings
for all to authenticated
using (
  private.is_app_admin()
  or private.staff_hub_business_admin(business_unit_id, 'admin')
)
with check (
  private.is_app_admin()
  or private.staff_hub_business_admin(business_unit_id, 'admin')
);

grant select on public.shop_presence_events to authenticated;
grant select on public.shop_presence_settings to authenticated;
grant insert, update, delete on public.shop_presence_events to authenticated;
grant insert, update, delete on public.shop_presence_settings to authenticated;

insert into public.shop_presence_settings (business_unit_id, open_hours)
values
(
  'c41fee76-63d4-42bc-b065-0584a1d41f4f'::uuid,
  '{"0":{"open":"11:00","close":"19:00"},"1":{"open":"10:00","close":"20:00"},"2":{"open":"10:00","close":"20:00"},"3":{"open":"10:00","close":"20:00"},"4":{"open":"10:00","close":"20:00"},"5":{"open":"10:00","close":"20:00"},"6":{"open":"10:00","close":"20:00"}}'::jsonb
),
(
  'f39374d8-7518-435d-9f8f-7af1cd42bff9'::uuid,
  '{"0":{"open":"11:00","close":"19:00"},"1":{"open":"10:00","close":"20:00"},"2":{"open":"10:00","close":"20:00"},"3":{"open":"10:00","close":"20:00"},"4":{"open":"10:00","close":"20:00"},"5":{"open":"10:00","close":"20:00"},"6":{"open":"10:00","close":"20:00"}}'::jsonb
)
on conflict (business_unit_id) do nothing;

create or replace function public.get_shop_presence_history(
  p_business_unit_id uuid,
  p_days integer default 14
)
returns table (
  business_date date,
  scheduled_open timestamptz,
  scheduled_close timestamptz,
  first_activity_at timestamptz,
  last_activity_at timestamptz,
  opening_delta_minutes integer,
  closing_delta_minutes integer,
  opening_status text,
  closing_status text,
  activity_count integer
)
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_timezone text;
  v_hours jsonb;
  v_open_grace integer;
  v_close_tolerance integer;
begin
  if p_business_unit_id is null then
    raise exception 'business_unit_id is required';
  end if;

  if not (private.is_app_admin() or private.staff_hub_business_admin(p_business_unit_id, 'view')) then
    raise exception 'You do not have access to this business.';
  end if;

  select timezone, open_hours, opening_grace_minutes, closing_early_tolerance_minutes
    into v_timezone, v_hours, v_open_grace, v_close_tolerance
  from public.shop_presence_settings
  where business_unit_id = p_business_unit_id
    and active = true;

  if v_timezone is null then
    return;
  end if;

  return query
  with dates as (
    select generate_series(
      ((now() at time zone v_timezone)::date - greatest(1, least(coalesce(p_days,14), 120)) + 1),
      (now() at time zone v_timezone)::date,
      interval '1 day'
    )::date as d
  ),
  schedule as (
    select
      d,
      ((d::text || ' ' || coalesce(v_hours->extract(dow from d)::int::text->>'open','10:00'))::timestamp at time zone v_timezone) as open_at,
      ((d::text || ' ' || coalesce(v_hours->extract(dow from d)::int::text->>'close','20:00'))::timestamp at time zone v_timezone) as close_at
    from dates
  ),
  activity as (
    select
      s.d,
      s.open_at,
      s.close_at,
      min(e.occurred_at) filter (
        where e.occurred_at >= s.open_at - interval '4 hours'
          and e.occurred_at <= s.close_at
          and e.event_type in ('person','door','manual')
      ) as first_at,
      max(e.occurred_at) filter (
        where e.occurred_at >= s.open_at
          and e.occurred_at <= s.close_at + interval '6 hours'
          and e.event_type in ('person','door','manual')
      ) as last_at,
      count(e.id) filter (
        where e.occurred_at >= s.open_at - interval '4 hours'
          and e.occurred_at <= s.close_at + interval '6 hours'
      )::integer as event_count
    from schedule s
    left join public.shop_presence_events e
      on (e.business_unit_id = p_business_unit_id or e.business_unit_id is null)
     and e.occurred_at >= s.open_at - interval '4 hours'
     and e.occurred_at <= s.close_at + interval '6 hours'
    group by s.d, s.open_at, s.close_at
  )
  select
    a.d,
    a.open_at,
    a.close_at,
    a.first_at,
    a.last_at,
    case when a.first_at is null then null else round(extract(epoch from (a.first_at - a.open_at))/60)::int end,
    case when a.last_at is null then null else round(extract(epoch from (a.last_at - a.close_at))/60)::int end,
    case
      when a.first_at is null then 'no_signal'
      when a.first_at <= a.open_at + make_interval(mins => v_open_grace) then 'verified'
      else 'late_signal'
    end,
    case
      when a.last_at is null then 'no_signal'
      when a.last_at < a.close_at - make_interval(mins => v_close_tolerance) then 'early_signal'
      when a.last_at > a.close_at then 'after_hours'
      else 'verified'
    end,
    a.event_count
  from activity a
  order by a.d desc;
end;
$$;

grant execute on function public.get_shop_presence_history(uuid, integer) to authenticated;

commit;