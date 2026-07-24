begin;

create table if not exists public.instagram_insights (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  synced_at timestamptz not null default now(),
  followers_count integer,
  -- Hour-of-day (0-23) -> relative follower online-activity score,
  -- straight from Instagram's own "online_followers" insight metric.
  -- This is literally "best time to post" data from Meta itself.
  online_followers_by_hour jsonb default '{}'::jsonb,
  reach_7d integer,
  impressions_7d integer,
  profile_views_7d integer,
  avg_engagement_rate numeric(6,3),
  -- Array of { id, caption, timestamp, like_count, comments_count, media_type }
  -- for the most recent/top-performing posts, used to compute
  -- best-performing posting windows from actual results, not just
  -- follower-online data.
  top_posts jsonb default '[]'::jsonb,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists instagram_insights_business_synced_idx
  on public.instagram_insights (business_unit_id, synced_at desc);

alter table public.instagram_insights enable row level security;

-- Same access pattern as the rest of the app: admin sees everything,
-- managers with operations or performance edit access for their
-- assigned business can view it too. No staff-level access -- this
-- is owner/manager marketing data, not something every staff member
-- needs to see.
create policy "instagram_insights_admin_all" on public.instagram_insights
  for all
  using (private.hub_is_admin())
  with check (private.hub_is_admin());

create policy "instagram_insights_manager_read" on public.instagram_insights
  for select
  using (
    private.can_module_view('operations')
    and private.can_access_business_unit(business_unit_id)
  );

commit;;
