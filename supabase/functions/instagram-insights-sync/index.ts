import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authorizeManager,
  corsHeaders,
  getAdminClient,
  jsonResponse,
  RequestError,
} from "../_shared/rtb.ts";

// Meta Graph API version -- verify this is still current before
// relying on it long-term; Meta periodically deprecates old
// versions and the "insights" metric names have changed before.
const GRAPH_API_VERSION = "v19.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function assertBusinessId(value: unknown) {
  const businessUnitId = String(value || "").trim();
  if (!businessUnitId) throw new RequestError("businessUnitId is required.", 400);
  return businessUnitId;
}

async function authorizeSync(req: Request, admin: ReturnType<typeof getAdminClient>, businessUnitId: string) {
  const expectedWorkerToken = Deno.env.get("RTB_SYNC_WORKER_TOKEN") || "";
  const providedWorkerToken = req.headers.get("x-rtb-worker-token") || "";

  if (expectedWorkerToken && providedWorkerToken && providedWorkerToken === expectedWorkerToken) {
    return { profile: null, user: null, worker: true };
  }

  const actor = await authorizeManager(req, admin, businessUnitId, [
    { module: "operations", minimum: "edit" },
    { module: "performance", minimum: "edit" },
  ]);
  return { ...actor, worker: false };
}

// Per-business secrets, e.g. INSTAGRAM_ACCESS_TOKEN__RTB_LOUNGE, so
// two locations can eventually have their own connected accounts.
// Falls back to a single shared INSTAGRAM_ACCESS_TOKEN if no
// business-specific one is set, for the common single-account case.
function getInstagramConfig(businessSlug: string) {
  const accessToken =
    Deno.env.get(`INSTAGRAM_ACCESS_TOKEN__${businessSlug}`) ||
    Deno.env.get("INSTAGRAM_ACCESS_TOKEN") ||
    "";
  const igUserId =
    Deno.env.get(`INSTAGRAM_BUSINESS_ACCOUNT_ID__${businessSlug}`) ||
    Deno.env.get("INSTAGRAM_BUSINESS_ACCOUNT_ID") ||
    "";

  if (!accessToken || !igUserId) {
    throw new RequestError(
      "Instagram isn't connected yet. Set INSTAGRAM_ACCESS_TOKEN and " +
        "INSTAGRAM_BUSINESS_ACCOUNT_ID (or the business-specific " +
        `__${businessSlug} versions) as Supabase function secrets.`,
      412,
    );
  }

  return { accessToken, igUserId };
}

function businessSlugFor(businessUnitId: string, businessName: string) {
  return String(businessName || businessUnitId)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function graphGet(path: string, accessToken: string) {
  const url = `${GRAPH_API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = body?.error?.message || `Instagram Graph API request failed (${response.status}).`;
    throw new RequestError(message, response.status === 401 || response.status === 403 ? 401 : 502);
  }

  return body;
}

// "online_followers" is Instagram's own metric for when your
// followers are actively on the app, broken down by hour (0-23).
// This is the direct API equivalent of the "best time to post" data
// already visible in the Instagram app's own Insights screen.
async function fetchOnlineFollowersByHour(igUserId: string, accessToken: string) {
  const data = await graphGet(`/${igUserId}/insights?metric=online_followers&period=lifetime`, accessToken);
  const values = data?.data?.[0]?.values || [];
  const latest = values[values.length - 1]?.value || {};
  // API returns keys as hour strings ("0".."23"); normalize to numbers.
  return Object.fromEntries(
    Object.entries(latest).map(([hour, count]) => [Number(hour), Number(count) || 0]),
  );
}

async function fetchAccountSummary(igUserId: string, accessToken: string) {
  const profile = await graphGet(`/${igUserId}?fields=followers_count`, accessToken);
  const insights = await graphGet(
    `/${igUserId}/insights?metric=reach,impressions,profile_views&period=day`,
    accessToken,
  );

  const metricTotal = (name: string) => {
    const series = insights?.data?.find((entry: { name: string }) => entry.name === name);
    const values = series?.values || [];
    return values.reduce((sum: number, point: { value: number }) => sum + (Number(point.value) || 0), 0);
  };

  return {
    followersCount: profile?.followers_count ?? null,
    reach7d: metricTotal("reach"),
    impressions7d: metricTotal("impressions"),
    profileViews7d: metricTotal("profile_views"),
  };
}

async function fetchTopPosts(igUserId: string, accessToken: string, limit: number) {
  const media = await graphGet(
    `/${igUserId}/media?fields=id,caption,timestamp,media_type,like_count,comments_count&limit=${limit}`,
    accessToken,
  );
  const posts = (media?.data || []).map((post: Record<string, unknown>) => ({
    id: post.id,
    caption: typeof post.caption === "string" ? post.caption.slice(0, 140) : "",
    timestamp: post.timestamp,
    media_type: post.media_type,
    like_count: Number(post.like_count) || 0,
    comments_count: Number(post.comments_count) || 0,
  }));

  const engagements = posts.map((post: { like_count: number; comments_count: number }) => post.like_count + post.comments_count);
  const avgEngagement = engagements.length
    ? engagements.reduce((sum: number, value: number) => sum + value, 0) / engagements.length
    : 0;

  return { posts, avgEngagement };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") throw new RequestError("Method not allowed.", 405);
    const admin = getAdminClient();
    const body = await req.json().catch(() => ({}));
    const businessUnitId = assertBusinessId(body.businessUnitId || body.business_unit_id);
    await authorizeSync(req, admin, businessUnitId);

    const { data: business, error: businessError } = await admin
      .from("business_units")
      .select("id,name")
      .eq("id", businessUnitId)
      .single();
    if (businessError) throw businessError;

    const businessSlug = businessSlugFor(businessUnitId, business?.name || "");
    const { accessToken, igUserId } = getInstagramConfig(businessSlug);

    const [onlineFollowersByHour, accountSummary, topPostsResult] = await Promise.all([
      fetchOnlineFollowersByHour(igUserId, accessToken),
      fetchAccountSummary(igUserId, accessToken),
      fetchTopPosts(igUserId, accessToken, Number(body.postLimit) || 25),
    ]);

    const record = {
      business_unit_id: businessUnitId,
      followers_count: accountSummary.followersCount,
      online_followers_by_hour: onlineFollowersByHour,
      reach_7d: accountSummary.reach7d,
      impressions_7d: accountSummary.impressions7d,
      profile_views_7d: accountSummary.profileViews7d,
      avg_engagement_rate: accountSummary.followersCount
        ? Number(((topPostsResult.avgEngagement / accountSummary.followersCount) * 100).toFixed(3))
        : null,
      top_posts: topPostsResult.posts,
      synced_at: new Date().toISOString(),
    };

    const { data: saved, error: insertError } = await admin
      .from("instagram_insights")
      .insert(record)
      .select("*")
      .single();
    if (insertError) throw insertError;

    return jsonResponse({ insights: saved });
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Instagram insights sync failed." },
      status,
    );
  }
});
