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
revoke execute on function public.claim_my_cleaner_checklist(uuid) from anon;
revoke execute on function public.claim_my_cleaning_all_businesses() from anon;
revoke execute on function public.disable_my_push_token(text) from anon;
revoke execute on function public.generate_staff_app_reminders() from anon;
revoke execute on function public.get_monthly_operations_leaderboard(uuid,date) from anon;
revoke execute on function public.get_my_ai_coaching() from anon;
revoke execute on function public.get_my_cleaner_dashboard(uuid) from anon;
revoke execute on function public.get_my_cleaning_operations_all_businesses() from anon;
revoke execute on function public.get_owner_activity_feed(uuid,integer) from anon;
revoke execute on function public.mark_my_ai_coaching_read(uuid) from anon;
revoke execute on function public.mark_owner_activity_read(uuid[]) from anon;
revoke execute on function public.mark_shop_ready(uuid,text) from anon;
revoke execute on function public.register_my_push_token(text,text,text,text) from anon;
revoke execute on function public.run_rtb_safe_automations() from anon;
revoke execute on function public.submit_station_inspection(uuid,uuid,text,text,text,text) from anon;

-- These are cron-only maintenance functions.
revoke execute on function public.run_rtb_safe_automations() from authenticated;
revoke execute on function public.generate_staff_app_reminders() from authenticated;

-- Public reviews stay public through RLS rather than a definer view.
alter view public.public_reviews_display set (security_invoker = true);
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
grant select on public.public_reviews_display to anon;

alter function public.rtb_disable_beauty_walkin_coverage_tasks() set search_path = public, private;
