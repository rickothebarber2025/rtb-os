import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authorizeManager,
  corsHeaders,
  getAdminClient,
  jsonResponse,
  readJson,
  RequestError,
} from "../_shared/rtb.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new RequestError("POST is required.", 405);

    const admin = getAdminClient();
    await authorizeManager(req, admin, null, [{ module: "access", minimum: "admin" }]);

    const body = await readJson(req) as Record<string, unknown>;
    const signInProfileId = String(body.signInProfileId || body.sign_in_profile_id || "").trim();
    const keepProfileId = String(body.keepProfileId || body.keep_profile_id || "").trim();

    if (!signInProfileId || !keepProfileId) {
      throw new RequestError("signInProfileId and keepProfileId are required.", 400);
    }
    if (signInProfileId === keepProfileId) {
      throw new RequestError("Choose two different profiles to link.", 400);
    }

    const { data: signInProfile, error: signInError } = await admin
      .from("user_profiles")
      .select("id,email")
      .eq("id", signInProfileId)
      .maybeSingle();
    if (signInError) throw signInError;
    if (!signInProfile) throw new RequestError("The sign-in profile was not found.", 404);

    const { data: keepProfile, error: keepError } = await admin
      .from("user_profiles")
      .select("*")
      .eq("id", keepProfileId)
      .maybeSingle();
    if (keepError) throw keepError;
    if (!keepProfile) throw new RequestError("The profile to keep was not found.", 404);

    const { error: deleteError } = await admin
      .from("user_profiles")
      .delete()
      .eq("id", signInProfileId);
    if (deleteError) throw deleteError;

    const { data: relinked, error: relinkError } = await admin
      .from("user_profiles")
      .update({
        active: true,
        id: signInProfileId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", keepProfileId)
      .select()
      .single();

    if (relinkError) throw relinkError;

    return jsonResponse({ profile: relinked });
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse({ error: err.message || "Unable to link accounts." }, status);
  }
});
