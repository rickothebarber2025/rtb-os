-- Ensure operational role templates keep access to the Staff Hub.
update public.user_profiles
set permissions = jsonb_set(
  coalesce(permissions, '{}'::jsonb),
  '{modules,staff_hub}',
  '"view"'::jsonb,
  true
),
updated_at = now()
where coalesce(permissions->>'role_template','') in (
  'staff_portal','beauty_manager','barbershop_manager','payroll_assistant',
  'operations_assistant','operations_cleaning','appointment_coordinator',
  'content_marketing','view_only'
)
and coalesce(permissions->'modules'->>'staff_hub','none') = 'none';

-- Internal SECURITY DEFINER RPCs are never anonymous endpoints.
-- Some historical production-only function bodies are version markers in source,
-- so fresh previews must revoke only functions that are present.
do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.claim_my_cleaner_checklist(uuid)',
    'public.claim_my_cleaning_all_businesses()',
    'public.disable_my_push_token(text)',
    'public.generate_staff_app_reminders()',
    'public.get_monthly_operations_leaderboard(uuid,date)',
    'public.get_my_ai_coaching()',
    'public.get_my_cleaner_dashboard(uuid)',
    'public.get_my_cleaning_operations_all_businesses()',
    'public.get_owner_activity_feed(uuid,integer)',
    'public.mark_my_ai_coaching_read(uuid)',
    'public.mark_owner_activity_read(uuid[])',
    'public.mark_shop_ready(uuid,text)',
    'public.register_my_push_token(text,text,text,text)',
    'public.run_rtb_safe_automations()',
    'public.submit_station_inspection(uuid,uuid,text,text,text,text)'
  ]
  loop
    if to_regprocedure(function_signature) is not null then
      execute format('revoke execute on function %s from anon', function_signature);
    end if;
  end loop;

  foreach function_signature in array array[
    'public.run_rtb_safe_automations()',
    'public.generate_staff_app_reminders()'
  ]
  loop
    if to_regprocedure(function_signature) is not null then
      execute format('revoke execute on function %s from authenticated', function_signature);
    end if;
  end loop;
end;
$$;

-- Public reviews stay public through RLS rather than a definer view.
do $
begin
  if to_regclass('public.public_reviews_display') is not null then
    execute 'alter view public.public_reviews_display set (security_invoker = true)';
  end if;
end;
$;

drop policy if exists reviews_public_display on public.reviews;
create policy reviews_public_display on public.reviews
for select to anon
using (
  source = any (array['google_business_profile'::text,'booksy_email'::text,'booksy_csv'::text])
  and rating >= 4
  and review_text is not null
  and length(review_text) > 0
);
grant select on public.reviews to anon;
do $
begin
  if to_regclass('public.public_reviews_display') is not null then
    execute 'grant select on public.public_reviews_display to anon';
  end if;
  if to_regprocedure('public.rtb_disable_beauty_walkin_coverage_tasks()') is not null then
    execute 'alter function public.rtb_disable_beauty_walkin_coverage_tasks() set search_path = public, private';
  end if;
end;
$;
