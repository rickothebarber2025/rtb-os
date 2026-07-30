import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SQUARE_API_BASE = "https://connect.squareup.com";
const SQUARE_VERSION = "2025-01-23";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const accessToken = Deno.env.get("SQUARE_ACCESS_TOKEN");
  if (!accessToken) {
    return new Response(
      JSON.stringify({ error: "SQUARE_ACCESS_TOKEN is not set." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }

  const results: Record<string, unknown> = {};

  // 1. Confirm the token itself is valid and see what merchant/locations it covers.
  const locationsRes = await fetch(`${SQUARE_API_BASE}/v2/locations`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_VERSION,
    },
  });
  const locationsBody = await locationsRes.json().catch(() => ({}));
  results.locations = { body: locationsBody, ok: locationsRes.ok, status: locationsRes.status };

  // 2. The actual thing we care about: can this token read team member shifts
  // (clock-in/clock-out) via the Labor API. This is the real test -- a
  // separate permission scope from the appointments/payments scopes the
  // existing Square integration already uses.
  const shiftsRes = await fetch(`${SQUARE_API_BASE}/v2/labor/shifts/search`, {
    body: JSON.stringify({
      query: {
        filter: {
          start: {
            start_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
      },
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    method: "POST",
  });
  const shiftsBody = await shiftsRes.json().catch(() => ({}));
  results.shifts = { body: shiftsBody, ok: shiftsRes.ok, status: shiftsRes.status };

  // 3. Team members, so we know whether we can even get real names back to
  // match against the staff roster the same way the payroll CSV import does.
  const teamRes = await fetch(`${SQUARE_API_BASE}/v2/team-members/search`, {
    body: JSON.stringify({}),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    method: "POST",
  });
  const teamBody = await teamRes.json().catch(() => ({}));
  results.teamMembers = { body: teamBody, ok: teamRes.ok, status: teamRes.status };

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
});
