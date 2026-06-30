import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  analyzeFeedbackResponse,
  processQueuedFeedbackAnalysis,
} from "../_shared/feedback-ai.ts";
import {
  RequestError,
  corsHeaders,
  getAdminClient,
  jsonResponse,
  readJson,
} from "../_shared/rtb.ts";

function validateRating(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw new RequestError(`${field} must be a 1-5 rating.`);
  }
  return number;
}

function validateNps(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 10) {
    throw new RequestError("Recommendation score must be 0-10.");
  }
  return number;
}

function normalizeSurveyResponse(payload: Record<string, unknown>) {
  const onTime = String(payload.appointment_started_on_time || "");
  const wouldReturn = String(payload.would_return || "");

  if (!["yes", "within_5_minutes", "more_than_10_minutes"].includes(onTime)) {
    throw new RequestError("Choose when the appointment started.");
  }

  if (!["definitely", "probably", "maybe", "no"].includes(wouldReturn)) {
    throw new RequestError("Choose whether you would return.");
  }

  return {
    additional_comments: String(payload.additional_comments || "").trim() || null,
    appointment_started_on_time: onTime,
    atmosphere_rating: validateRating(payload.atmosphere_rating, "Atmosphere"),
    cleanliness_rating: validateRating(payload.cleanliness_rating, "Cleanliness"),
    favorite_part: String(payload.favorite_part || "").trim() || null,
    improvement_suggestion: String(payload.improvement_suggestion || "").trim() || null,
    overall_rating: validateRating(payload.overall_rating, "Overall experience"),
    professionalism_rating: validateRating(payload.professionalism_rating, "Professionalism"),
    recommend_business: validateNps(payload.recommend_business),
    welcome_rating: validateRating(payload.welcome_rating, "Welcome"),
    would_return: wouldReturn,
  };
}

async function getFeedbackRequest(admin: ReturnType<typeof getAdminClient>, token: string) {
  if (!token) throw new RequestError("Survey token is required.", 400);

  const { data, error } = await admin
    .from("feedback_requests")
    .select(`
      id,
      business_id,
      staff_id,
      service_name,
      customer_name,
      status,
      send_after,
      sent_at,
      completed_at,
      expires_at,
      created_at,
      business_units(name),
      staff(full_name)
    `)
    .eq("survey_token", token)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new RequestError("Survey link was not found.", 404);

  if (data.status !== "completed" && new Date(data.expires_at).getTime() < Date.now()) {
    await admin
      .from("feedback_requests")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ...data, status: "expired" };
  }

  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const admin = getAdminClient();

    if (req.method === "GET") {
      const url = new URL(req.url);
      const token = url.searchParams.get("token") || "";
      const request = await getFeedbackRequest(admin, token);

      return jsonResponse({
        request: {
          businessName: request.business_units?.name || "RTB",
          completedAt: request.completed_at,
          customerName: request.customer_name,
          expiresAt: request.expires_at,
          serviceName: request.service_name,
          staffName: request.staff?.full_name || "",
          status: request.status,
        },
      });
    }

    if (req.method !== "POST") {
      throw new RequestError("Method not allowed.", 405);
    }

    const body = await readJson(req);
    const token = String(body.token || "").trim();
    const request = await getFeedbackRequest(admin, token);

    if (request.status === "completed") {
      throw new RequestError("This survey has already been completed.", 409);
    }

    if (request.status === "expired") {
      throw new RequestError("This survey link has expired.", 410);
    }

    const surveyResponse = normalizeSurveyResponse(body.response || {});
    const { data: savedResponse, error: responseError } = await admin
      .from("feedback_responses")
      .insert({
        ...surveyResponse,
        feedback_request_id: request.id,
      })
      .select()
      .single();

    if (responseError) throw responseError;

    await admin
      .from("feedback_requests")
      .update({
        completed_at: new Date().toISOString(),
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id);

    await admin
      .from("feedback_ai_jobs")
      .insert({
        feedback_response_id: savedResponse.id,
        job_type: "analyze_feedback",
        status: "queued",
      });

    EdgeRuntime.waitUntil(
      processQueuedFeedbackAnalysis(admin, { maxJobs: 1, responseId: savedResponse.id })
        .catch(async () => {
          await analyzeFeedbackResponse(admin, savedResponse.id).catch(() => null);
        }),
    );

    return jsonResponse({
      message: "Thank you. Your feedback was saved.",
      responseId: savedResponse.id,
    });
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unable to save feedback." },
      status,
    );
  }
});
