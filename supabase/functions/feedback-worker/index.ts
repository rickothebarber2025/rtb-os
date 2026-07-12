import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  RequestError,
  authorizeManager,
  cleanText,
  corsHeaders,
  getAdminClient,
  jsonResponse,
  maxBatchSize,
  normalizeIssueKey,
  numberValue,
  readJson,
} from "../_shared/rtb.ts";

type AdminClient = ReturnType<typeof createClient>;

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_STAFF_COACH_MODEL = "gpt-4o-mini";
const FEEDBACK_WORKER_REQUIREMENTS = [
  { module: "performance", minimum: "edit" },
  { module: "operations", minimum: "edit" },
  { module: "settings", minimum: "admin" },
];

const CATEGORY_KEYWORDS: Array<[string, string[]]> = [
  ["Reception Experience", ["front", "desk", "reception", "greet", "welcome", "check in"]],
  ["Wait Time", ["late", "wait", "waiting", "delay", "behind", "on time"]],
  ["Cleanliness", ["clean", "dirty", "dust", "smell", "hygiene", "sanitary"]],
  ["Service Quality", ["service", "lash", "nail", "hair", "cut", "fade", "brow", "quality"]],
  ["Atmosphere", ["music", "vibe", "atmosphere", "temperature", "lighting", "noise"]],
  ["Communication", ["confusing", "unclear", "communication", "explain", "instructions"]],
  ["Pricing", ["price", "cost", "expensive", "charge", "payment"]],
];

const CATEGORY_ACTIONS: Record<string, string[]> = {
  "Atmosphere": [
    "Review music, scent, temperature, and waiting-area comfort during the busiest service blocks.",
    "Create a weekly atmosphere checklist.",
    "Assign an owner to inspect lighting, music, and comfort before opening.",
  ],
  "Cleanliness": [
    "Create a visible cleaning checklist for stations, waiting area, and restroom.",
    "Assign mid-day reset duties.",
    "Review cleanliness during weekly operations closeout.",
  ],
  "Communication": [
    "Create a simple client communication script for service timing, pricing, and next steps.",
    "Train staff to confirm the service plan before starting.",
    "Add clearer signage or confirmation text where customers get confused.",
  ],
  "Pricing": [
    "Review how pricing is communicated before checkout.",
    "Add a confirmation step before add-ons or upgrades.",
    "Audit service menu names and descriptions.",
  ],
  "Reception Experience": [
    "Create a reception greeting checklist.",
    "Train the team on check-in, waiting updates, and handoff language.",
    "Improve front-desk signage and first-time client instructions.",
  ],
  "Service Quality": [
    "Review the service standard for the issue mentioned and coach the assigned staff member.",
    "Add a quality-control checklist for the service.",
    "Follow up with recent clients after similar services.",
  ],
  "Wait Time": [
    "Create a late-appointment recovery script and notify clients before delays pass five minutes.",
    "Review appointment buffers for services that regularly run over.",
    "Track late-start reasons for two weeks.",
  ],
  "Customer Experience": [
    "Review the feedback with the manager and turn the issue into a weekly operating checklist.",
    "Assign an owner and check progress during the next team meeting.",
    "Follow up with similar customers after the fix is made.",
  ],
};

const feedbackAnalysisSchema = {
  additionalProperties: false,
  properties: {
    confidence_score: { maximum: 1, minimum: 0, type: "number" },
    estimated_cost: { enum: ["Low", "Medium", "High"], type: "string" },
    estimated_impact: { enum: ["Low", "Medium", "High"], type: "string" },
    main_category: { type: "string" },
    negative_points: { items: { type: "string" }, type: "array" },
    positive_points: { items: { type: "string" }, type: "array" },
    priority: { enum: ["low", "medium", "high", "urgent"], type: "string" },
    sentiment: { enum: ["positive", "neutral", "mixed", "negative"], type: "string" },
    suggested_action: { type: "string" },
    summary: { type: "string" },
  },
  required: [
    "sentiment",
    "summary",
    "positive_points",
    "negative_points",
    "main_category",
    "priority",
    "suggested_action",
    "estimated_cost",
    "estimated_impact",
    "confidence_score",
  ],
  type: "object",
};

const consultantSchema = {
  additionalProperties: false,
  properties: {
    biggest_problems: {
      items: {
        additionalProperties: false,
        properties: {
          detail: { type: "string" },
          priority: { type: "string" },
          title: { type: "string" },
        },
        required: ["title", "detail", "priority"],
        type: "object",
      },
      type: "array",
    },
    confidence_score: { maximum: 1, minimum: 0, type: "number" },
    delegate_recommendations: {
      items: {
        additionalProperties: false,
        properties: {
          task: { type: "string" },
          why: { type: "string" },
        },
        required: ["task", "why"],
        type: "object",
      },
      type: "array",
    },
    fix_first: { type: "string" },
    highest_roi: { type: "string" },
    lowest_cost: { type: "string" },
    recurring_problems: {
      items: {
        additionalProperties: false,
        properties: {
          count: { type: "number" },
          title: { type: "string" },
        },
        required: ["title", "count"],
        type: "object",
      },
      type: "array",
    },
    summary: { type: "string" },
  },
  required: [
    "summary",
    "biggest_problems",
    "fix_first",
    "highest_roi",
    "lowest_cost",
    "recurring_problems",
    "delegate_recommendations",
    "confidence_score",
  ],
  type: "object",
};

const staffCoachingSchema = {
  additionalProperties: false,
  items: {
    additionalProperties: false,
    properties: {
      staff_id: { type: "string" },
      full_name: { type: "string" },
      summary: { type: "string" },
      growth_tip: { type: "string" },
      service_tip: { type: "string" },
      tip_tip: { type: "string" },
      next_action: { type: "string" },
      priority: { enum: ["low", "medium", "high"], type: "string" },
    },
    required: [
      "staff_id",
      "full_name",
      "summary",
      "growth_tip",
      "service_tip",
      "tip_tip",
      "next_action",
      "priority",
    ],
    type: "object",
  },
  type: "array",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function detectCategory(text: string) {
  const haystack = text.toLowerCase();
  const match = CATEGORY_KEYWORDS.find(([, keywords]) =>
    keywords.some((keyword) => haystack.includes(keyword)),
  );
  return match?.[0] || "Customer Experience";
}

function ratingAverage(response: Record<string, unknown>) {
  const fields = [
    "overall_rating",
    "welcome_rating",
    "cleanliness_rating",
    "professionalism_rating",
    "atmosphere_rating",
  ];
  return fields.reduce((total, key) => total + numberValue(response[key]), 0) / fields.length;
}

function extractResponseText(body: Record<string, any>) {
  if (body.output_text) return body.output_text;

  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.type === "text" && content.text) return content.text;
    }
  }

  return "";
}

function fallbackAnalysis(context: Record<string, any>, rawError: string | null = null) {
  const response = context.response || {};
  const text = [
    response.favorite_part,
    response.improvement_suggestion,
    response.additional_comments,
  ].filter(Boolean).join(" ");
  const category = detectCategory(text);
  const average = ratingAverage(response);
  const nps = numberValue(response.recommend_business, 0);
  const late = response.appointment_started_on_time === "more_than_10_minutes";
  const wouldReturn = response.would_return;
  const negativePoints = [
    response.improvement_suggestion,
    late ? "Appointment started more than 10 minutes late." : "",
    wouldReturn === "no" ? "Customer said they would not return." : "",
  ].filter(Boolean).map((item) => cleanText(item));
  const positivePoints = [
    response.favorite_part,
    average >= 4 ? "Customer gave strong service ratings." : "",
    nps >= 9 ? "Customer is likely to recommend the business." : "",
  ].filter(Boolean).map((item) => cleanText(item));
  const sentiment =
    average >= 4 && nps >= 8 && !negativePoints.length ? "positive" :
    average <= 2 || nps <= 5 || wouldReturn === "no" ? "negative" :
    negativePoints.length && positivePoints.length ? "mixed" :
    "neutral";
  const priority =
    sentiment === "negative" && (late || nps <= 5 || average <= 2) ? "high" :
    sentiment === "negative" || late || average <= 3 ? "medium" :
    "low";
  const estimatedCost = ["Reception Experience", "Wait Time", "Communication", "Cleanliness"].includes(category)
    ? "Low"
    : "Medium";
  const estimatedImpact = priority === "high" || category === "Service Quality" ? "High" : "Medium";
  const actions = CATEGORY_ACTIONS[category] || CATEGORY_ACTIONS["Customer Experience"];

  return {
    confidence_score: rawError ? 0.62 : 0.74,
    estimated_cost: estimatedCost,
    estimated_impact: estimatedImpact,
    main_category: category,
    model: "local-fallback",
    negative_points: negativePoints.slice(0, 4),
    positive_points: positivePoints.slice(0, 4),
    priority,
    raw_result: rawError ? { fallback: true, error: rawError } : { fallback: true },
    sentiment,
    suggested_action: actions[0],
    summary:
      response.improvement_suggestion
        ? `Customer feedback points to ${category.toLowerCase()}: ${cleanText(response.improvement_suggestion)}`
        : `Customer feedback was analyzed under ${category.toLowerCase()}.`,
  };
}

function normalizeAnalysis(analysis: Record<string, any>, rawResult: Record<string, unknown>, model: string) {
  return {
    confidence_score: clamp(numberValue(analysis.confidence_score, 0.7), 0, 1),
    estimated_cost: ["Low", "Medium", "High"].includes(analysis.estimated_cost) ? analysis.estimated_cost : "Low",
    estimated_impact: ["Low", "Medium", "High"].includes(analysis.estimated_impact) ? analysis.estimated_impact : "Medium",
    main_category: cleanText(analysis.main_category, "Customer Experience"),
    model,
    negative_points: Array.isArray(analysis.negative_points) ? analysis.negative_points.slice(0, 6) : [],
    positive_points: Array.isArray(analysis.positive_points) ? analysis.positive_points.slice(0, 6) : [],
    priority: ["low", "medium", "high", "urgent"].includes(analysis.priority) ? analysis.priority : "medium",
    raw_result: rawResult,
    sentiment: ["positive", "neutral", "mixed", "negative"].includes(analysis.sentiment)
      ? analysis.sentiment
      : "mixed",
    suggested_action: cleanText(
      analysis.suggested_action,
      "Assign an owner and turn this feedback into a tracked improvement.",
    ),
    summary: cleanText(analysis.summary, "Customer feedback was analyzed."),
  };
}

async function structuredOpenAI(prompt: string, payload: Record<string, unknown>, schema: Record<string, unknown>, name: string, modelOverride?: string) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model = modelOverride || Deno.env.get("OPENAI_MODEL") || DEFAULT_MODEL;
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: [
        { content: prompt, role: "system" },
        { content: JSON.stringify(payload), role: "user" },
      ],
      model,
      text: {
        format: {
          name,
          schema,
          strict: true,
          type: "json_schema",
        },
      },
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || "OpenAI request failed.");
  }

  return { body, model, parsed: JSON.parse(extractResponseText(body)) };
}

async function analyzeStaffCoaching(payload: Record<string, unknown>) {
  const prompt =
    "You are RTB OS, an AI coach for salon and barbershop operations. Analyze each staff member separately using their role, total net sales, total tips, tip rate, average week, best week, under-minimum weeks, adjusted weeks, fixed-rate status, tier, and weeks recorded. Return only valid JSON. Give different, specific coaching for each staff member. Focus on revenue growth, better tip earning behavior, customer experience, and a clear next conversation Ricko can bring up. Avoid generic repeated wording. For barbers, hairstylists, nail techs, and lash techs, tailor the advice to the actual service role. If data is limited, state the missing signal and give one baseline action.";

  try {
    const model = Deno.env.get("OPENAI_STAFF_COACH_MODEL") || DEFAULT_STAFF_COACH_MODEL;
    const ai = await structuredOpenAI(
      prompt,
      payload,
      staffCoachingSchema,
      "rtb_staff_coaching",
      model,
    );

    if (!ai) return [];
    return Array.isArray(ai.parsed) ? ai.parsed : [];
  } catch (_err) {
    return [];
  }
}

async function getFeedbackContext(admin: AdminClient, responseId: string) {
  const { data: response, error: responseError } = await admin
    .from("feedback_responses")
    .select("*")
    .eq("id", responseId)
    .single();
  if (responseError) throw responseError;

  const { data: request, error: requestError } = await admin
    .from("feedback_requests")
    .select("*")
    .eq("id", response.feedback_request_id)
    .single();
  if (requestError) throw requestError;

  const [{ data: staff }, { data: business }] = await Promise.all([
    request.staff_id
      ? admin.from("staff").select("id,full_name,role,tier").eq("id", request.staff_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("business_units").select("id,name,type").eq("id", request.business_id).maybeSingle(),
  ]);

  return { business, request, response, staff };
}

async function analyzeFeedback(context: Record<string, any>) {
  try {
    const ai = await structuredOpenAI(
      "You are RTB OS, an AI business consultant for salon and barbershop operations. Analyze one customer survey and return only the requested JSON. Be specific, practical, and cost-aware.",
      {
        business: context.business,
        feedback: context.response,
        request: context.request,
        staff: context.staff,
      },
      feedbackAnalysisSchema,
      "rtb_feedback_analysis",
    );

    if (!ai) return fallbackAnalysis(context);
    return normalizeAnalysis(ai.parsed, ai.body, ai.model);
  } catch (err) {
    return fallbackAnalysis(context, err instanceof Error ? err.message : "AI analysis failed.");
  }
}

function projectTasks(category: string) {
  const actions = CATEGORY_ACTIONS[category] || CATEGORY_ACTIONS["Customer Experience"];
  return [
    actions[0],
    actions[1] || "Train staff on the updated workflow.",
    actions[2] || "Assign an owner and review progress weekly.",
    "Assign owner",
    "Track completion and review customer feedback again in 30 days.",
  ];
}

async function maybeCreateImprovementProject(
  admin: AdminClient,
  businessId: string,
  analysis: Record<string, any>,
) {
  const { data: recurringRows, error: recurringError } = await admin
    .from("customer_feedback_enriched")
    .select("feedback_response_id")
    .eq("business_id", businessId)
    .eq("main_category", analysis.main_category);
  if (recurringError) throw recurringError;

  const recurringCount = recurringRows?.length || 0;
  if (recurringCount < 2 && !["high", "urgent"].includes(analysis.priority)) return null;

  const issueKey = normalizeIssueKey(analysis.main_category);
  const title = `Improve ${analysis.main_category}`;
  const reason =
    recurringCount >= 2
      ? `Mentioned by ${recurringCount} customers.`
      : `High-priority customer feedback: ${analysis.summary}`;

  const { data: existing, error: existingError } = await admin
    .from("business_improvement_projects")
    .select("*")
    .eq("business_id", businessId)
    .eq("issue_key", issueKey)
    .neq("status", "ignored")
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    const sourceRefIds = new Set([...(existing.source_ref_ids || []), analysis.id]);
    const { data: updated, error: updateError } = await admin
      .from("business_improvement_projects")
      .update({
        confidence_score: analysis.confidence_score,
        estimated_cost: analysis.estimated_cost,
        estimated_revenue_impact: analysis.estimated_impact,
        priority: analysis.priority,
        reason,
        recurring_count: Math.max(recurringCount, numberValue(existing.recurring_count, 1)),
        source_ref_ids: [...sourceRefIds],
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (updateError) throw updateError;
    return updated;
  }

  const { data: project, error: insertError } = await admin
    .from("business_improvement_projects")
    .insert({
      business_id: businessId,
      confidence_score: analysis.confidence_score,
      estimated_cost: analysis.estimated_cost,
      estimated_revenue_impact: analysis.estimated_impact,
      issue_key: issueKey,
      priority: analysis.priority,
      reason,
      recurring_count: Math.max(recurringCount, 1),
      source_ref_ids: [analysis.id],
      source_type: "customer_feedback",
      title,
    })
    .select()
    .single();
  if (insertError) throw insertError;

  const { error: taskError } = await admin
    .from("business_improvement_tasks")
    .insert(projectTasks(analysis.main_category).map((taskTitle) => ({
      project_id: project.id,
      title: taskTitle,
    })));
  if (taskError) throw taskError;

  return project;
}

async function analyzeFeedbackResponse(admin: AdminClient, responseId: string) {
  const context = await getFeedbackContext(admin, responseId);
  const analysis = await analyzeFeedback(context);
  const { data: savedAnalysis, error: analysisError } = await admin
    .from("ai_feedback_analysis")
    .upsert(
      {
        confidence_score: analysis.confidence_score,
        estimated_cost: analysis.estimated_cost,
        estimated_impact: analysis.estimated_impact,
        feedback_response_id: responseId,
        main_category: analysis.main_category,
        model: analysis.model,
        negative_points: analysis.negative_points,
        positive_points: analysis.positive_points,
        priority: analysis.priority,
        raw_result: analysis.raw_result,
        sentiment: analysis.sentiment,
        suggested_action: analysis.suggested_action,
        summary: analysis.summary,
      },
      { onConflict: "feedback_response_id" },
    )
    .select()
    .single();
  if (analysisError) throw analysisError;

  const project = await maybeCreateImprovementProject(
    admin,
    context.request.business_id,
    savedAnalysis,
  );

  if (project) {
    await admin
      .from("ai_feedback_analysis")
      .update({ created_project_id: project.id })
      .eq("id", savedAnalysis.id);
  }

  return { analysis: savedAnalysis, project };
}

async function processQueuedFeedbackAnalysis(
  admin: AdminClient,
  options: { businessId?: string | null; maxJobs?: number } = {},
) {
  const maxJobs = options.maxJobs || 5;
  const { data: jobs, error: jobsError } = await admin
    .from("feedback_ai_jobs")
    .select("*")
    .in("status", ["queued", "failed"])
    .lt("attempts", 3)
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(maxJobs * 3);
  if (jobsError) throw jobsError;

  const processed = [];
  const skipped = [];

  for (const job of jobs || []) {
    if (processed.length >= maxJobs) break;

    try {
      const context = await getFeedbackContext(admin, job.feedback_response_id);
      if (options.businessId && context.request.business_id !== options.businessId) {
        skipped.push(job.id);
        continue;
      }

      await admin
        .from("feedback_ai_jobs")
        .update({
          attempts: numberValue(job.attempts) + 1,
          error: null,
          locked_at: new Date().toISOString(),
          status: "processing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      const result = await analyzeFeedbackResponse(admin, job.feedback_response_id);

      await admin
        .from("feedback_ai_jobs")
        .update({
          completed_at: new Date().toISOString(),
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      processed.push({ id: job.id, projectId: result.project?.id || null });
    } catch (err) {
      await admin
        .from("feedback_ai_jobs")
        .update({
          error: err instanceof Error ? err.message : "Feedback analysis failed.",
          run_after: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
  }

  return { processed, skipped };
}

function buildConsultantFallback(input: {
  feedback: Record<string, any>[];
  projects: Record<string, any>[];
  sources: Record<string, any>[];
}) {
  const openProjects = input.projects.filter((project) => !["done", "ignored"].includes(project.status));
  const problems = [
    ...openProjects
      .sort((a, b) => numberValue(b.recurring_count) - numberValue(a.recurring_count))
      .slice(0, 3)
      .map((project) => ({
        detail: project.reason,
        priority: project.priority,
        title: project.title,
      })),
    ...input.sources.slice(0, 3).map((source) => ({
      detail: source.source_type,
      priority: "medium",
      title: source.title,
    })),
  ].slice(0, 3);
  const first = problems[0]?.title || "Collect more customer feedback before making a major change.";
  const lowCost = openProjects.find((project) => project.estimated_cost === "Low")?.title || first;
  const highImpact = openProjects.find((project) => project.estimated_revenue_impact === "High")?.title || first;

  return {
    biggest_problems: problems,
    confidence_score: 0.68,
    delegate_recommendations: openProjects.slice(0, 3).map((project) => ({
      task: project.title,
      why: "This should have an owner and a follow-up date.",
    })),
    fix_first: first,
    highest_roi: highImpact,
    lowest_cost: lowCost,
    recurring_problems: openProjects
      .filter((project) => numberValue(project.recurring_count) >= 2)
      .slice(0, 5)
      .map((project) => ({
        count: project.recurring_count,
        title: project.title,
      })),
    summary:
      problems.length
        ? `RTB OS found ${problems.length} priority business improvement area${problems.length === 1 ? "" : "s"}.`
        : "Add customer feedback, reviews, audits, reports, and notes for stronger recommendations.",
  };
}

async function createBusinessConsultantReport(
  admin: AdminClient,
  businessId: string,
  userId: string | null,
) {
  const [{ data: feedback }, { data: projects }, { data: sources }, { data: business }] =
    await Promise.all([
      admin
        .from("customer_feedback_enriched")
        .select("*")
        .eq("business_id", businessId)
        .order("response_created_at", { ascending: false })
        .limit(100),
      admin
        .from("business_improvement_projects")
        .select("*")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: false })
        .limit(100),
      admin
        .from("business_intelligence_sources")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(100),
      admin.from("business_units").select("id,name,type").eq("id", businessId).maybeSingle(),
    ]);

  const fallback = buildConsultantFallback({
    feedback: feedback || [],
    projects: projects || [],
    sources: sources || [],
  });
  let report = fallback;
  let model: string | null = null;

  try {
    const ai = await structuredOpenAI(
      "You are RTB OS, an AI business consultant for a salon/barbershop operator. Analyze all provided intelligence and answer with practical priorities. Return only JSON.",
      {
        business,
        customer_feedback: (feedback || []).slice(0, 50),
        intelligence_sources: (sources || []).slice(0, 50),
        improvement_projects: (projects || []).slice(0, 50),
      },
      consultantSchema,
      "rtb_business_consultant_report",
    );
    if (ai) {
      report = ai.parsed;
      model = ai.model;
    }
  } catch (_err) {
    report = fallback;
  }

  const { data: saved, error } = await admin
    .from("ai_business_consultant_reports")
    .insert({
      biggest_problems: report.biggest_problems || [],
      business_id: businessId,
      confidence_score: clamp(numberValue(report.confidence_score, 0.7), 0, 1),
      created_by: userId,
      delegate_recommendations: report.delegate_recommendations || [],
      fix_first: cleanText(report.fix_first, fallback.fix_first),
      highest_roi: cleanText(report.highest_roi, fallback.highest_roi),
      lowest_cost: cleanText(report.lowest_cost, fallback.lowest_cost),
      model,
      recurring_problems: report.recurring_problems || [],
      summary: cleanText(report.summary, fallback.summary),
    })
    .select()
    .single();
  if (error) throw error;

  return saved;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") throw new RequestError("Method not allowed.", 405);

    const admin = getAdminClient();
    const body = await readJson(req);
    const action = String(body.action || "process").trim().replace(/_/g, '-').toLowerCase();
    const businessId = body.businessId || body.business_id || null;
    const auth = await authorizeManager(req, admin, businessId, FEEDBACK_WORKER_REQUIREMENTS);

    if (action === "process") {
      const result = await processQueuedFeedbackAnalysis(admin, {
        businessId,
        maxJobs: maxBatchSize(body.maxJobs, 5, 25),
      });

      return jsonResponse({
        processed: result.processed.length,
        skipped: result.skipped.length,
        results: result.processed,
      });
    }

    if (action === "consultant-report") {
      if (!businessId) throw new RequestError("Choose one business before running the consultant.");

      const report = await createBusinessConsultantReport(admin, businessId, auth.user.id);
      return jsonResponse({ report });
    }

    if (action === "staff-coaching") {
      if (!businessId) throw new RequestError("Choose one business before requesting staff coaching.");

      const [{ data: business, error: businessError }, { data: performance, error: performanceError }, { data: staffRows, error: staffError }] = await Promise.all([
        admin.from("business_units").select("id,name,type").eq("id", businessId).maybeSingle(),
        admin.from("staff_performance_summary").select("*").eq("business_id", businessId),
        admin.from("staff").select("id,full_name,role,fixed_rate").eq("business_unit_id", businessId),
      ]);

      if (businessError || !business) throw businessError || new RequestError("Unable to load business data.", 500);
      if (performanceError) throw performanceError;
      if (staffError) throw staffError;

      const coaching = await analyzeStaffCoaching({
        business,
        performance: performance || [],
        staff: staffRows || [],
      });

      return jsonResponse({
        coaching: coaching || [],
        ai_available: Boolean(coaching?.length),
      });
    }

    throw new RequestError("Unknown feedback worker action.", 400);
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Feedback worker failed." },
      status,
    );
  }
});
