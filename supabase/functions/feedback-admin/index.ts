import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  RequestError,
  authorizeManager,
  cleanText,
  corsHeaders,
  getAdminClient,
  getSurveyUrl,
  jsonResponse,
  maxBatchSize,
  profileCanAccessBusiness,
  readJson,
} from "../_shared/rtb.ts";

const OWNER_EMAIL = "rickothebarber@gmail.com";
const FEEDBACK_EDIT_REQUIREMENTS = [
  { module: "performance", minimum: "edit" },
  { module: "operations", minimum: "edit" },
  { module: "settings", minimum: "admin" },
];

function parseDelayHours(value: unknown) {
  const number = Number(value ?? Deno.env.get("FEEDBACK_DEFAULT_DELAY_HOURS") ?? 2);
  if (!Number.isFinite(number) || number < 0 || number > 168) return 2;
  return number;
}

function addHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

// Basic, deliberately permissive format checks -- these exist to
// catch obvious typos (missing @, letters in a phone number) before
// a request reaches Resend, not to fully validate deliverability.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts optional +country code, then 7-15 digits, allowing common
// separators (space, dash, dot, parentheses) which are stripped first.
const PHONE_DIGITS_PATTERN = /^\+?[0-9]{7,15}$/;

function assertValidEmail(email: string) {
  if (!EMAIL_PATTERN.test(email)) {
    throw new RequestError(`"${email}" doesn't look like a valid email address.`);
  }
}

function assertValidPhone(phone: string) {
  const stripped = phone.replace(/[\s\-.()]/g, "");
  if (!PHONE_DIGITS_PATTERN.test(stripped)) {
    throw new RequestError(`"${phone}" doesn't look like a valid phone number.`);
  }
}

function normalizeRequest(payload: Record<string, unknown>) {
  const businessId = cleanText(payload.business_id || payload.businessId);
  const customerName = cleanText(payload.customer_name || payload.customerName);
  const customerEmail = cleanText(payload.customer_email || payload.customerEmail);
  const customerPhone = cleanText(payload.customer_phone || payload.customerPhone);
  const delayHours = parseDelayHours(payload.delay_hours || payload.delayHours);

  if (!businessId) throw new RequestError("Business is required.");
  if (!customerName) throw new RequestError("Customer name is required.");
  if (!customerEmail && !customerPhone) {
    throw new RequestError("Add a customer email or phone number.");
  }
  if (customerEmail) assertValidEmail(customerEmail);
  if (customerPhone) assertValidPhone(customerPhone);

  return {
    appointment_id: cleanText(payload.appointment_id || payload.appointmentId) || null,
    business_id: businessId,
    customer_email: customerEmail || null,
    customer_id: cleanText(payload.customer_id || payload.customerId) || null,
    customer_name: customerName,
    customer_phone: customerPhone || null,
    delivery_channel: cleanText(payload.delivery_channel || payload.deliveryChannel, customerEmail ? "email" : "sms"),
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
    send_after: addHours(delayHours),
    service_name: cleanText(payload.service_name || payload.serviceName, "Appointment"),
    staff_id: cleanText(payload.staff_id || payload.staffId) || null,
  };
}

function messageText(request: Record<string, any>, businessName: string) {
  const link = getSurveyUrl(request.survey_token);
  return {
    html: `
      <p>Hi ${request.customer_name},</p>
      <p>Thank you for visiting ${businessName}. We would appreciate quick feedback about your ${request.service_name || "appointment"}.</p>
      <p><a href="${link}">Open your RTB feedback survey</a></p>
      <p>This helps us improve the business and support the team.</p>
    `,
    subject: `${businessName} feedback request`,
    text:
      `Hi ${request.customer_name}, thank you for visiting ${businessName}. ` +
      `Please share quick feedback about your ${request.service_name || "appointment"}: ${link}`,
  };
}

async function sendEmail(request: Record<string, any>, businessName: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { delivered: false, reason: "RESEND_API_KEY is not configured." };

  const from = Deno.env.get("FEEDBACK_FROM_EMAIL") || "RTB OS <onboarding@resend.dev>";
  const content = messageText(request, businessName);
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      html: content.html,
      subject: content.subject,
      text: content.text,
      to: [request.customer_email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { delivered: false, reason: body?.message || "Resend email failed." };
  }

  return { delivered: true, provider: "resend", providerId: body?.id || null };
}

// TextBee sends via a phone you own, not a rented virtual number, so
// it needs a real E.164-formatted destination number rather than the
// loosely-validated digits stored on the request (raw 10-digit North
// American numbers, or ones with dashes/parens, are both currently
// accepted by PHONE_DIGITS_PATTERN above). Assumes North America
// (+1) for a bare 10-digit number, which matches this business.
function toE164(rawPhone: string) {
  const digits = String(rawPhone || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return rawPhone.trim().startsWith("+") ? rawPhone.trim() : `+${digits}`;
}

async function sendSms(request: Record<string, any>, businessName: string) {
  const apiKey = Deno.env.get("TEXTBEE_API_KEY");
  const deviceId = Deno.env.get("TEXTBEE_DEVICE_ID");

  if (!apiKey || !deviceId) {
    return { delivered: false, reason: "TextBee SMS secrets are not configured." };
  }

  const recipient = toE164(request.customer_phone);
  if (!recipient) {
    return { delivered: false, reason: "No valid phone number on this request." };
  }

  const content = messageText(request, businessName);
  const response = await fetch(
    `https://api.textbee.dev/api/v1/gateway/devices/${encodeURIComponent(deviceId)}/send-sms`,
    {
      body: JSON.stringify({
        message: content.text,
        recipients: [recipient],
      }),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      method: "POST",
    },
  );
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      delivered: false,
      reason: result?.error || result?.message || `TextBee SMS failed (HTTP ${response.status}).`,
    };
  }

  return { delivered: true, provider: "textbee", providerId: result?.data?.[0]?._id || null };
}

async function dispatchOne(admin: ReturnType<typeof getAdminClient>, request: Record<string, any>) {
  const businessName = request.business_units?.name || "RTB";
  const manualMode =
    Deno.env.get("FEEDBACK_DELIVERY_MODE") === "manual" ||
    request.delivery_channel === "manual";
  const delivery =
    manualMode
      ? { delivered: true, provider: "manual", providerId: null }
      : request.delivery_channel === "sms"
        ? await sendSms(request, businessName)
        : await sendEmail(request, businessName);

  if (!delivery.delivered) {
    await admin
      .from("feedback_requests")
      .update({
        metadata: {
          ...(request.metadata || {}),
          delivery_error: delivery.reason,
          survey_url: getSurveyUrl(request.survey_token),
        },
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    return { id: request.id, ok: false, reason: delivery.reason, surveyUrl: getSurveyUrl(request.survey_token) };
  }

  await admin
    .from("feedback_requests")
    .update({
      metadata: {
        ...(request.metadata || {}),
        delivery_provider: delivery.provider,
        delivery_provider_id: delivery.providerId,
        survey_url: getSurveyUrl(request.survey_token),
      },
      sent_at: new Date().toISOString(),
      status: "sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id);

  return { id: request.id, ok: true, provider: delivery.provider, surveyUrl: getSurveyUrl(request.survey_token) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") throw new RequestError("Method not allowed.", 405);
    const admin = getAdminClient();
    const body = await readJson(req);
    const action = String(body.action || "create-request");
    const targetBusinessId = body.businessId || body.business_id || body.request?.business_id || body.request?.businessId;
    const auth = await authorizeManager(req, admin, targetBusinessId || null, FEEDBACK_EDIT_REQUIREMENTS);

    if (action === "create-request") {
      const payload = normalizeRequest(body.request || {});
      await authorizeManager(req, admin, payload.business_id, FEEDBACK_EDIT_REQUIREMENTS);

      const { data, error } = await admin
        .from("feedback_requests")
        .insert(payload)
        .select("*,business_units(name),staff(full_name)")
        .single();

      if (error) throw error;

      return jsonResponse({
        request: {
          ...data,
          surveyUrl: getSurveyUrl(data.survey_token),
        },
      });
    }

    if (action === "dispatch-due") {
      const limit = maxBatchSize(body.limit, Number(Deno.env.get("FEEDBACK_DISPATCH_LIMIT") || 20), 50);
      let query = admin
        .from("feedback_requests")
        .select("*,business_units(name)")
        .in("status", ["pending", "failed"])
        .lte("send_after", new Date().toISOString())
        .order("send_after", { ascending: true })
        .limit(limit);

      if (targetBusinessId) query = query.eq("business_id", targetBusinessId);

      const { data: requests, error } = await query;
      if (error) throw error;

      const results = [];
      for (const request of requests || []) {
        if (!auth.profile?.active && String(auth.profile?.email || "").toLowerCase() !== OWNER_EMAIL) {
          continue;
        }
        if (!profileCanAccessBusiness(auth.profile, request.business_id)) {
          continue;
        }
        results.push(await dispatchOne(admin, request));
      }

      return jsonResponse({
        dispatched: results.filter((result) => result.ok).length,
        failed: results.filter((result) => !result.ok).length,
        results,
      });
    }

    if (action === "expire-old") {
      let query = admin
        .from("feedback_requests")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .in("status", ["pending", "sent", "failed"])
        .lt("expires_at", new Date().toISOString())
        .select("id");

      if (targetBusinessId) query = query.eq("business_id", targetBusinessId);

      const { data, error } = await query;
      if (error) throw error;
      return jsonResponse({ expired: data?.length || 0 });
    }

    throw new RequestError("Unknown feedback admin action.", 400);
  } catch (err) {
    const status = err instanceof RequestError ? err.status : 500;
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Feedback request failed." },
      status,
    );
  }
});
