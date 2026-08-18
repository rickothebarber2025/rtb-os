begin;

-- When iOS registration finally succeeds, do not leave recent push jobs stuck
-- forever in no_device. This is the state we observed in production: RTB OS was
-- creating push jobs, but no device token had registered yet.
create or replace function public.register_my_push_token(
  p_token text,
  p_platform text default 'ios',
  p_bundle_id text default 'com.rtbheadquaters.os'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if nullif(trim(p_token), '') is null then
    raise exception 'Push token is required.';
  end if;

  insert into public.push_device_tokens(
    user_id,
    token,
    platform,
    bundle_id,
    active,
    last_seen_at,
    updated_at
  )
  values (
    auth.uid(),
    trim(p_token),
    coalesce(nullif(trim(p_platform), ''), 'ios'),
    coalesce(nullif(trim(p_bundle_id), ''), 'com.rtbheadquaters.os'),
    true,
    now(),
    now()
  )
  on conflict(token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    bundle_id = excluded.bundle_id,
    active = true,
    disabled_at = null,
    last_seen_at = now(),
    updated_at = now()
  returning id into v_id;

  update public.push_notification_queue
  set
    status = 'pending',
    attempt_count = 0,
    attempts = 0,
    last_error = null,
    processed_at = null,
    next_attempt_at = now(),
    updated_at = now()
  where user_id = auth.uid()
    and status = 'no_device'
    and created_at >= now() - interval '7 days';

  return v_id;
end;
$function$;

revoke all on function public.register_my_push_token(text, text, text)
from public, anon;

grant execute on function public.register_my_push_token(text, text, text)
to authenticated;

commit;
