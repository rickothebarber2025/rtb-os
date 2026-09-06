import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPEN_CASE_STATUSES = ["open", "waiting_approval", "in_progress"];
const CASE_STATUSES = [...OPEN_CASE_STATUSES, "resolved", "ignored"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function serviceKey() {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!keys) return "";
  try {
    const parsed = JSON.parse(keys);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return "";
  }
}

async function safe<T>(promise: PromiseLike<{ data: T | null; error: unknown }>, fallback: T): Promise<T> {
  try {
    const result = await promise;
    return result.error ? fallback : (result.data ?? fallback);
  } catch {
    return fallback;
  }
}

function torontoDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function questionNeedsFinancialData(question: string) {
  return /\b(payroll|pay|earnings|sales|revenue|tips|take[- ]?home|commission|money|financial|profit|cost|wage)\b/i.test(question);
}

function normalizePersonName(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCaseKey(value: unknown, category: string, title: string) {
  const raw = clean(value) || `${category}:${title}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || `${category}:general`;
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function higherPriority(a: unknown, b: unknown) {
  const rank = new Map(PRIORITIES.map((value, index) => [value, index]));
  const left = clean(a).toLowerCase();
  const right = clean(b).toLowerCase();
  return (rank.get(right) ?? 1) > (rank.get(left) ?? 1) ? right : (rank.has(left) ? left : right || "normal");
}

function parseMessageAt(value: unknown) {
  const date = value ? new Date(String(value)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function parseFacts(value: unknown) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, 30) : [];
}

async function gatherContext(admin: ReturnType<typeof createClient>, businessId: string, options: {
  audience: "admin" | "staff_hub";
  currentStaffId?: string | null;
  includeFinancial: boolean;
}) {
  const today = torontoDate();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const adminAudience = options.audience === "admin";
  const ownStaffId = options.currentStaffId || null;
  const unavailableSources: Array<{ source: string; error: string }> = [];
  const read = async <T>(source: string, promise: PromiseLike<{ data: T | null; error: any }>, fallback: T): Promise<T> => {
    try {
      const result = await promise;
      if (result.error) {
        unavailableSources.push({ source, error: clean(result.error.message || result.error.code || "Query failed.") });
        return fallback;
      }
      return result.data ?? fallback;
    } catch (error) {
      unavailableSources.push({ source, error: error instanceof Error ? error.message : "Query failed." });
      return fallback;
    }
  };

  const [business, staff] = await Promise.all([
    read("business", admin.from("business_units").select("id,name,type").eq("id", businessId).maybeSingle(), null),
    read("staff_roster",
      admin.from("staff")
        .select("id,full_name,role,tier,active")
        .eq("business_unit_id", businessId)
        .eq("active", true)
        .order("full_name")
        .limit(60),
      [],
    ),
  ]);

  const roster = staff as any[];
  const allowedStaffIds = adminAudience ? roster.map((row) => row.id) : ownStaffId ? [ownStaffId] : [];

  const [checklists, tasks, requests, attendance, performance, payroll, content, feedback, communicationCases] = await Promise.all([
    read("checklists",
      admin.from("operation_checklist_runs")
        .select("id,staff_id,run_date,checklist_type,scope,status,completion_percent,final_confirmed_at,items:operation_checklist_run_items(label,status,completed_at,completed_by_staff_id,note)")
        .eq("business_unit_id", businessId)
        .gte("run_date", today)
        .order("created_at", { ascending: false })
        .limit(30),
      [],
    ),
    read("staff_tasks",
      admin.from("staff_tasks")
        .select("id,staff_id,title,category,details,due_date,status,completed_at,created_at")
        .eq("business_unit_id", businessId)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true })
        .limit(60),
      [],
    ),
    read("operations_requests",
      admin.from("staff_operations_requests")
        .select("id,staff_id,request_type,category,title,priority,status,created_at")
        .eq("business_unit_id", businessId)
        .neq("status", "resolved")
        .order("created_at", { ascending: false })
        .limit(40),
      [],
    ),
    read("attendance",
      admin.from("staff_attendance")
        .select("staff_id,clock_in,clock_out,status")
        .eq("business_unit_id", businessId)
        .gte("clock_in", weekAgo)
        .order("clock_in", { ascending: false })
        .limit(80),
      [],
    ),
    adminAudience
      ? read("performance",
          admin.from("staff_performance_summary")
            .select("staff_id,total_net_sales,transactions,average_ticket")
            .eq("business_unit_id", businessId)
            .limit(50),
          [],
        )
      : Promise.resolve([]),
    options.includeFinancial && allowedStaffIds.length
      ? read("payroll",
          admin.from("payroll_entries")
            .select("staff_id,staff_name_snapshot,net_sales,tips,take_home,created_at")
            .in("staff_id", allowedStaffIds)
            .gte("created_at", monthAgo)
            .order("created_at", { ascending: false })
            .limit(40),
          [],
        )
      : Promise.resolve([]),
    adminAudience
      ? read("content",
          admin.from("staff_content_submissions")
            .select("staff_id,status,content_type,created_at")
            .eq("business_unit_id", businessId)
            .order("created_at", { ascending: false })
            .limit(40),
          [],
        )
      : Promise.resolve([]),
    adminAudience
      ? read("customer_feedback",
          admin.from("customer_feedback_enriched")
            .select("rating,review_text,sentiment,main_category,priority,response_created_at")
            .eq("business_id", businessId)
            .gte("response_created_at", monthAgo)
            .order("response_created_at", { ascending: false })
            .limit(30),
          [],
        )
      : Promise.resolve([]),
    adminAudience
      ? read("communications",
          admin.from("ada_communication_cases")
            .select("id,staff_id,contact_name,case_key,category,title,summary,next_action,action_type,execution_mode,priority,status,approval_required,due_hint,confidence_score,source_count,extracted_data,first_message_at,last_message_at")
            .eq("business_unit_id", businessId)
            .in("status", OPEN_CASE_STATUSES)
            .order("last_message_at", { ascending: false })
            .limit(40),
          [],
        )
      : Promise.resolve([]),
  ]);

  const filterMine = (rows: any[]) =>
    adminAudience || !ownStaffId ? rows : rows.filter((row) => row.staff_id === ownStaffId);

  return {
    business,
    roster: adminAudience ? roster : roster.filter((row) => row.id === ownStaffId),
    today_checklists: adminAudience ? checklists : filterMine(checklists as any[]),
    open_tasks: filterMine(tasks as any[]),
    unresolved_requests: filterMine(requests as any[]),
    attendance_last_7_days: filterMine(attendance as any[]),
    performance_snapshot: adminAudience ? performance : [],
    payroll_last_30_days: options.includeFinancial ? filterMine(payroll as any[]) : [],
    recent_content_submissions: adminAudience ? content : [],
    recent_customer_feedback: adminAudience ? feedback : [],
    open_communication_cases: adminAudience ? communicationCases : [],
    generated_at: new Date().toISOString(),
    timezone: "America/Toronto",
    audience: options.audience,
    source_status: {
      state: unavailableSources.length ? "partial" : "live",
      unavailable: unavailableSources,
      observed_at: new Date().toISOString(),
    },
  };
}

const suggestedTaskSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    details: { type: "string" },
    category: { type: "string" },
    suggested_staff_name: { type: "string" },
    priority: { type: "string" },
    due_hint: { type: "string" },
  },
  required: ["title", "details", "category", "suggested_staff_name", "priority", "due_hint"],
};

const responseSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    summary: { type: "string" },
    confidence_score: { type: "number" },
    evidence: { type: "array", items: { type: "string" } },
    priorities: { type: "array", items: { type: "string" } },
    suggested_tasks: { type: "array", items: suggestedTaskSchema },
    risks: { type: "array", items: { type: "string" } },
    opportunities: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "summary", "confidence_score", "evidence", "priorities", "suggested_tasks", "risks", "opportunities"],
};

const messageClassificationSchema = {
  type: "object",
  properties: {
    classification: {
      type: "string",
      enum: ["actionable", "information", "acknowledgement", "resolution", "noise"],
    },
    category: {
      type: "string",
      enum: ["attendance", "availability", "time_off", "supplies", "cash", "payroll", "client", "policy", "maintenance", "opportunity", "follow_up", "coverage", "general"],
    },
    case_key: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    next_action: { type: "string" },
    action_type: {
      type: "string",
      enum: ["task", "reply", "calendar", "schedule_update", "time_off_review", "purchase_request", "coverage_review", "policy_decision", "cash_review", "payroll_review", "maintenance_follow_up", "business_follow_up", "none"],
    },
    execution_mode: {
      type: "string",
      enum: ["automatic_capture", "approval_required", "owner_action", "no_action"],
    },
    priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
    requires_action: { type: "boolean" },
    requires_reply: { type: "boolean" },
    approval_required: { type: "boolean" },
    due_hint: { type: "string" },
    confidence_score: { type: "number" },
    resolution_signal: { type: "string", enum: ["none", "possible", "strong"] },
    extracted_facts: { type: "array", items: { type: "string" } },
  },
  required: [
    "classification", "category", "case_key", "title", "summary", "next_action", "action_type",
    "execution_mode", "priority", "requires_action", "requires_reply", "approval_required", "due_hint",
    "confidence_score", "resolution_signal", "extracted_facts",
  ],
};

async function askGeminiWithSchema(
  apiKey: string,
  model: string,
  prompt: string,
  payload: unknown,
  schema: unknown,
  maxOutputTokens = 1200,
) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    }),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(raw?.error?.message || "Ada request failed.");
  const text = raw?.candidates?.[0]?.content?.parts?.find((part: any) => part.text)?.text || "";
  if (!text) throw new Error("Ada returned an empty response.");
  return JSON.parse(text);
}

async function classifyCommunication(
  apiKey: string,
  model: string,
  payload: unknown,
) {
  const system = [
    "You are Ada's communications triage engine for RTB Lounge and RTB Beauty Lounge.",
    "Your job is to prevent operational commitments from being lost inside ordinary text conversations.",
    "Classify the message using only the supplied message, staff match, recent related messages, and open cases.",
    "Actionable examples include lateness, absence, availability or schedule changes, time-off requests, supply requests, cash/payment discrepancies, payroll questions, client problems, policy decisions, maintenance, coverage, promises, meetings, and business follow-ups.",
    "Greetings, thank-yous and acknowledgements are usually not new work. Do not create a case just because a person sent a message.",
    "Group repeat issues using a stable case_key. Repeated lateness for the same person should reuse attendance:late-arrival rather than creating a new case each time.",
    "If the current message explicitly completes or confirms completion of an existing issue, return resolution_signal=strong and reuse that case_key. Use possible when resolution is ambiguous.",
    "For an existing case, summary must describe the current combined state, not only the newest message.",
    "Schedule changes, time-off approvals, payroll/cash decisions, policy decisions, compensation, permissions, or staff-record changes require owner approval. Mark approval_required=true and execution_mode=approval_required.",
    "Safe capture, grouping, extraction and follow-up tracking can use execution_mode=automatic_capture. Never treat disciplinary or compensation decisions as automatic.",
    "Extract concrete facts such as dates, hours, amounts, requested supplies, promised follow-ups, and deadlines into extracted_facts.",
    "Return JSON only.",
  ].join(" ");

  return askGeminiWithSchema(apiKey, model, system, payload, messageClassificationSchema, 900);
}

async function resolveStaffForContact(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  staffId: string,
  contactName: string,
) {
  const roster = await safe(
    admin.from("staff")
      .select("id,full_name,business_unit_id,active")
      .eq("business_unit_id", businessId)
      .eq("active", true)
      .limit(100),
    [],
  ) as any[];

  if (staffId) return roster.find((row) => row.id === staffId) || null;
  const contactKey = normalizePersonName(contactName);
  if (!contactKey) return null;

  const exact = roster.find((row) => normalizePersonName(row.full_name) === contactKey);
  if (exact) return exact;

  return roster.find((row) => {
    const staffKey = normalizePersonName(row.full_name);
    return Boolean(staffKey && (contactKey.startsWith(`${staffKey} `) || staffKey.startsWith(`${contactKey} `)));
  }) || null;
}

async function getCommunicationContext(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  staffId: string | null,
  contactName: string,
) {
  const [cases, recentMessages] = await Promise.all([
    safe(
      admin.from("ada_communication_cases")
        .select("id,staff_id,contact_name,case_key,category,title,summary,next_action,action_type,execution_mode,priority,status,approval_required,due_hint,source_count,extracted_data,last_message_at")
        .eq("business_unit_id", businessId)
        .in("status", OPEN_CASE_STATUSES)
        .order("last_message_at", { ascending: false })
        .limit(30),
      [],
    ),
    safe(
      admin.from("ada_communication_messages")
        .select("id,staff_id,contact_name,direction,body,message_at,classification,priority,requires_action,requires_reply,extracted_data,case_id")
        .eq("business_unit_id", businessId)
        .order("message_at", { ascending: false })
        .limit(80),
      [],
    ),
  ]);

  const contactKey = normalizePersonName(contactName);
  const belongs = (row: any) => staffId
    ? row.staff_id === staffId
    : normalizePersonName(row.contact_name) === contactKey;

  return {
    open_cases: (cases as any[]).filter(belongs).slice(0, 12),
    recent_messages: (recentMessages as any[]).filter(belongs).slice(0, 20).reverse(),
  };
}

async function ingestCommunication(
  admin: ReturnType<typeof createClient>,
  apiKey: string,
  model: string,
  businessId: string,
  body: any,
) {
  const message = body.message && typeof body.message === "object" ? body.message : body;
  const direction = clean(message.direction || "incoming").toLowerCase() === "outgoing" ? "outgoing" : "incoming";
  const text = clean(message.body || message.text || message.message);
  const senderName = clean(message.senderName || message.sender_name || (direction === "incoming" ? message.contactName : "Ricko"));
  const recipientName = clean(message.recipientName || message.recipient_name || (direction === "outgoing" ? message.contactName : "Ricko"));
  const contactName = clean(message.contactName || message.contact_name || (direction === "incoming" ? senderName : recipientName));
  const contactHandle = clean(message.contactHandle || message.contact_handle || message.senderHandle || message.sender_handle);
  const source = ["imessage", "sms", "shortcut", "mac_messages", "manual", "other"].includes(clean(message.source).toLowerCase())
    ? clean(message.source).toLowerCase()
    : "shortcut";
  const externalMessageId = clean(message.externalMessageId || message.external_message_id) || null;
  const conversationId = clean(message.conversationId || message.conversation_id) || null;
  const messageAt = parseMessageAt(message.messageAt || message.message_at || message.date);
  const requestedStaffId = clean(message.staffId || message.staff_id);

  if (!text) throw new Error("Message text is required.");
  if (!contactName) throw new Error("A contact name is required.");

  if (externalMessageId) {
    const duplicate = await safe(
      admin.from("ada_communication_messages")
        .select("id,case_id,processed_at")
        .eq("source", source)
        .eq("external_message_id", externalMessageId)
        .maybeSingle(),
      null as any,
    );
    if (duplicate) return { duplicate: true, message: duplicate };
  }

  const staff = await resolveStaffForContact(admin, businessId, requestedStaffId, contactName);
  const related = await getCommunicationContext(admin, businessId, staff?.id || null, contactName);
  const classification = await classifyCommunication(apiKey, model, {
    business_id: businessId,
    contact: {
      name: contactName,
      matched_staff: staff ? { id: staff.id, full_name: staff.full_name } : null,
    },
    current_message: {
      direction,
      sender_name: senderName || null,
      recipient_name: recipientName || null,
      text,
      message_at: messageAt,
    },
    ...related,
  });

  const category = clean(classification.category) || "general";
  const title = clean(classification.title) || `${contactName}: follow-up`;
  const caseKey = normalizeCaseKey(classification.case_key, category, title);
  const priority = PRIORITIES.includes(clean(classification.priority).toLowerCase())
    ? clean(classification.priority).toLowerCase()
    : "normal";
  const extractedFacts = parseFacts(classification.extracted_facts);
  const confidence = clampConfidence(classification.confidence_score);

  const candidateCases = related.open_cases as any[];
  let existingCase = candidateCases.find((item) => item.case_key === caseKey) || null;
  if (!existingCase && classification.resolution_signal === "strong") {
    const categoryMatches = candidateCases.filter((item) => item.category === category);
    if (categoryMatches.length === 1) existingCase = categoryMatches[0];
  }

  const { data: insertedMessage, error: messageError } = await admin.from("ada_communication_messages")
    .insert({
      business_unit_id: businessId,
      case_id: existingCase?.id || null,
      staff_id: staff?.id || null,
      source,
      direction,
      contact_name: contactName,
      sender_name: senderName || null,
      recipient_name: recipientName || null,
      contact_handle: contactHandle || null,
      conversation_id: conversationId,
      external_message_id: externalMessageId,
      body: text,
      message_at: messageAt,
      classification: clean(classification.classification) || null,
      priority,
      requires_action: Boolean(classification.requires_action),
      requires_reply: Boolean(classification.requires_reply),
      confidence_score: confidence,
      extracted_data: { facts: extractedFacts },
      processed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (messageError) throw messageError;

  let communicationCase = existingCase;
  const resolutionStrong = classification.resolution_signal === "strong";
  const shouldTrack = Boolean(classification.requires_action) || Boolean(existingCase) || resolutionStrong;

  if (shouldTrack) {
    const sourceCount = existingCase ? Number(existingCase.source_count || 1) + 1 : 1;
    const repeatedLate = category === "attendance" && caseKey.includes("late") && sourceCount >= 3;
    const effectivePriority = repeatedLate ? higherPriority(existingCase?.priority, "high") : higherPriority(existingCase?.priority, priority);
    const approvalRequired = Boolean(classification.approval_required);
    const executionMode = resolutionStrong
      ? "no_action"
      : approvalRequired
        ? "approval_required"
        : clean(classification.execution_mode) || "owner_action";
    const status = resolutionStrong
      ? "resolved"
      : approvalRequired
        ? "waiting_approval"
        : existingCase?.status === "in_progress"
          ? "in_progress"
          : "open";

    const payload = {
      business_unit_id: businessId,
      staff_id: staff?.id || existingCase?.staff_id || null,
      contact_name: contactName,
      case_key: caseKey,
      category,
      title,
      summary: clean(classification.summary) || text,
      next_action: resolutionStrong ? "No further action unless the issue reopens." : clean(classification.next_action) || "Review message.",
      action_type: resolutionStrong ? "none" : clean(classification.action_type) || "task",
      execution_mode: executionMode,
      priority: effectivePriority,
      status,
      approval_required: resolutionStrong ? false : approvalRequired,
      due_hint: resolutionStrong ? null : clean(classification.due_hint) || null,
      confidence_score: confidence,
      source_count: sourceCount,
      extracted_data: { facts: extractedFacts },
      first_message_at: existingCase?.first_message_at || messageAt,
      last_message_at: messageAt,
      resolved_at: resolutionStrong ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    if (existingCase) {
      const { data, error } = await admin.from("ada_communication_cases")
        .update(payload)
        .eq("id", existingCase.id)
        .eq("business_unit_id", businessId)
        .select()
        .single();
      if (error) throw error;
      communicationCase = data;
    } else if (!resolutionStrong) {
      const { data, error } = await admin.from("ada_communication_cases")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      communicationCase = data;
    }

    if (communicationCase?.id && insertedMessage?.case_id !== communicationCase.id) {
      await admin.from("ada_communication_messages")
        .update({ case_id: communicationCase.id })
        .eq("id", insertedMessage.id);
    }
  }

  return {
    duplicate: false,
    staff_match: staff ? { id: staff.id, full_name: staff.full_name } : null,
    classification: {
      ...classification,
      case_key: caseKey,
      priority,
      confidence_score: confidence,
      extracted_facts: extractedFacts,
    },
    message: insertedMessage,
    case: communicationCase,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const key = serviceKey();
    if (!supabaseUrl || !key) return json({ error: "Supabase function secrets are missing." }, 500);

    const admin = createClient(supabaseUrl, key, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid or expired." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = clean(body.action || "ask").toLowerCase();
    const businessId = clean(body.businessId || body.business_id);
    const question = clean(body.question);
    if (!businessId) return json({ error: "Choose one business first." }, 400);

    const { data: profile, error: profileError } = await admin.from("user_profiles")
        .select("email,active,business_unit_id,permissions,role")
        .eq("id", authData.user.id)
        .maybeSingle();
    if (profileError) throw profileError;

    const owner = clean(profile?.email).toLowerCase() === "rickothebarber@gmail.com";
    const permissions = profile?.permissions || {};
    const modules = permissions.modules || permissions;
    const operationsLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.operations).toLowerCase());
    const dashboardLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.dashboard).toLowerCase());
    const payrollLevel = ["none", "view", "edit", "admin"].indexOf(clean(modules.payroll).toLowerCase());
    const businessIds = Array.isArray(permissions.business_unit_ids) ? permissions.business_unit_ids.map(String) : [];
    const businessAllowed = owner || permissions.business_scope === "all" || businessIds.includes("all-businesses") || businessIds.includes(businessId) || profile?.business_unit_id === businessId;
    if (!profile?.active || !businessAllowed) return json({ error: "You do not have access to this business." }, 403);

    const manager = owner || operationsLevel >= 2 || dashboardLevel >= 1 || ["admin", "manager", "owner"].includes(clean(profile?.role).toLowerCase());
    const audience: "admin" | "staff_hub" = manager ? "admin" : "staff_hub";
    const currentStaff = await safe(
      admin.from("staff")
        .select("id,full_name,email")
        .eq("business_unit_id", businessId)
        .ilike("email", clean(profile?.email))
        .maybeSingle(),
      null as any,
    );

    if (action === "communications") {
      if (!manager) return json({ error: "Manager access is required to view communications intelligence." }, 403);
      const [caseResult, messageResult] = await Promise.all([
        admin.from("ada_communication_cases")
            .select("*")
            .eq("business_unit_id", businessId)
            .in("status", OPEN_CASE_STATUSES)
            .order("priority", { ascending: false })
            .order("last_message_at", { ascending: false })
            .limit(60),
        admin.from("ada_communication_messages")
            .select("id,case_id,staff_id,contact_name,direction,source,body,message_at,classification,priority,requires_action,requires_reply,extracted_data")
            .eq("business_unit_id", businessId)
            .order("message_at", { ascending: false })
            .limit(80),
      ]);
      const unavailable = [
        caseResult.error ? { source: "communication_cases", error: clean(caseResult.error.message || caseResult.error.code) } : null,
        messageResult.error ? { source: "communication_messages", error: clean(messageResult.error.message || messageResult.error.code) } : null,
      ].filter(Boolean);
      return json({
        cases: caseResult.data || [],
        messages: messageResult.data || [],
        source_status: {
          state: unavailable.length ? "partial" : "live",
          unavailable,
          observed_at: new Date().toISOString(),
        },
      }, unavailable.length === 2 ? 503 : 200);
    }

    if (action === "case-status") {
      if (!manager) return json({ error: "Manager access is required to update communication cases." }, 403);
      const caseId = clean(body.caseId || body.case_id);
      const status = clean(body.status).toLowerCase();
      if (!caseId || !CASE_STATUSES.includes(status)) return json({ error: "A valid case and status are required." }, 400);
      const { data, error } = await admin.from("ada_communication_cases")
        .update({
          status,
          resolved_at: status === "resolved" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", caseId)
        .eq("business_unit_id", businessId)
        .select()
        .single();
      if (error) throw error;
      return json({ case: data });
    }

    if (action === "automation") return json({ error: "Ada cannot execute RTB automations from this read-and-prepare endpoint." }, 403);

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) return json({ error: "Ada is temporarily unavailable." }, 503);
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest";

    if (action === "ingest-message") {
      if (!manager) return json({ error: "Manager access is required to ingest communications." }, 403);
      return json(await ingestCommunication(admin, geminiKey, model, businessId, body));
    }

    if (action === "ask" && !question) return json({ error: "Ask Ada a question first." }, 400);

    const includeFinancial = Boolean(
      (owner || payrollLevel >= 1) && action === "ask" && questionNeedsFinancialData(question),
    );
    const context = await gatherContext(admin, businessId, {
      audience,
      currentStaffId: currentStaff?.id || null,
      includeFinancial,
    });

    const system = audience === "admin"
      ? [
          "You are Ada, RTB's owner copilot for RTB Lounge and RTB Beauty Lounge.",
          "Use only supplied RTB OS data and never invent facts or fill missing values.",
          "Think across operations, staffing, attendance, tasks, communications, customer experience, content, performance, and financial data when permission allows.",
          "Open communication cases are unresolved commitments extracted from owner/staff texts. Treat them as first-class operational work and consolidate repeated patterns rather than recommending duplicate tasks.",
          "Answer the owner's actual question first, then identify the most important decision or next action.",
          "Be critical: distinguish symptoms from root causes and call out weak processes, missed follow-up, repeated patterns, or unnecessary owner workload.",
          "When evidence supports action, return concrete suggested_tasks with a clear owner, priority and due hint. Do not create or modify payroll, compensation, permissions, or disciplinary records yourself.",
          "Do not recommend disciplinary or compensation decisions from a single weak signal. Use patterns and explain uncertainty.",
          "Keep evidence traceable to the supplied context. Return JSON only.",
          "The context includes source_status. If it is partial, state which sources are unavailable and do not interpret missing rows as zero activity.",
        ].join(" ")
      : [
          "You are Ada inside RTB Staff Hub.",
          "Use only the permitted data supplied for this staff member. Never reveal other staff private, payroll, communication, or owner-only information.",
          "Give practical next actions and explain what is due, incomplete, or blocking progress.",
          "Never invent facts and never alter records. Return JSON only.",
        ].join(" ");

    const effectiveQuestion = action === "summary"
      ? audience === "admin"
        ? "Give me today's owner brief. Start with unresolved communication commitments if any are urgent or high priority. Identify what requires my attention, what can be delegated, one risk, one opportunity, and up to three concrete suggested tasks without duplicating existing cases."
        : "Give me today's staff brief with what is due, what is incomplete, and the best next action."
      : question;

    const parsed = await askGeminiWithSchema(geminiKey, model, system, { question: effectiveQuestion, context }, responseSchema, 1200);
    return json({
      ...parsed,
      communication_cases: audience === "admin" ? (context.open_communication_cases || []).slice(0, 10) : [],
      model,
      audience,
      data_scope: audience === "admin" ? "rtb_os_ada_admin" : "rtb_os_ada_staff",
      source_status: context.source_status,
      generated_at: new Date().toISOString(),
      cached: false,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Ada failed." }, 500);
  }
});
