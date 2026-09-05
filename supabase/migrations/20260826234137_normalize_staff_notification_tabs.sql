create or replace function private.staff_notification_tab(p_type text)
returns text
language sql
immutable
set search_path = public, private
as $$
  select case
    when lower(coalesce(p_type,'')) ~ '(clean|opening|closing|shift|attendance|task|inventory|maintenance|shop_status)' then 'daily'
    when lower(coalesce(p_type,'')) ~ '(announcement|policy|update)' then 'home'
    when lower(coalesce(p_type,'')) ~ '(performance|coaching|goal)' then 'stats'
    else 'daily'
  end;
$$;

update public.push_notification_queue
set
  data = jsonb_set(
    jsonb_set(coalesce(data, '{}'::jsonb), '{tab}', '"stats"'::jsonb, true),
    '{staff_hub_tab}',
    '"stats"'::jsonb,
    true
  ),
  updated_at = now()
where source_table = 'staff_operation_notifications'
  and (data->>'tab' = 'performance' or data->>'staff_hub_tab' = 'performance');
