import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "npm:jose@6";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-dispatch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
const PROCESSING_TIMEOUT_MINUTES = 10;
const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);

type QueueJob = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  attempt_count: number | null;
};

type DeviceToken = {
  id: string;
  token: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

let cachedJwt = "";
let cachedJwtExpiresAt = 0;

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

function authorized(req: Request) {
  const secret = Deno.env.get("PUSH_DISPATCH_SECRET") || "";
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` || req.headers.get("x-push-dispatch-secret") === secret;
}

async function apnsJwt() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwtExpiresAt > now + 120) return cachedJwt;

  const keyId = Deno.env.get("APNS_KEY_ID") || "";
  const teamId = Deno.env.get("APNS_TEAM_ID") || "";
  const rawKey = Deno.env.get("APNS_PRIVATE_KEY") || "";
  if (!keyId || !teamId || !rawKey) throw new Error("APNs credentials are not configured.");

  const privateKey = await importPKCS8(rawKey.replace(/\\n/g, "\n"), "ES256");
  cachedJwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(privateKey);
  cachedJwtExpiresAt = now + 2700;
  return cachedJwt;
}

async function sendApns(token: string, title: string, body: string, data: Record<string, unknown> = {}) {
  const jwt = await apnsJwt();
  const bundleId = Deno.env.get("APNS_BUNDLE_ID") || "com.rtbheadquaters.os";
  const environment = (Deno.env.get("APNS_ENVIRONMENT") || "production").toLowerCase();
  const host = environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const response = await fetch(`${host}/3/device/${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({ aps: { alert: { title, body }, sound: "default" }, ...data }),
  });
  const details = response.ok ? null : await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, details };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function backoffDate(attempts: number) {
  return new Date(Date.now() + Math.min(60, attempts * 5) * 60_000).toISOString();
}

async function reviveStaleProcessingJobs(admin: ReturnType<typeof createClient>, now: string) {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MINUTES * 60_000).toISOString();
  await admin
    .from("push_notification_queue")
    .update({
      status: "pending",
      last_error: "Dispatcher timed out while processing. Requeued automatically.",
      next_attempt_at: now,
      updated_at: now,
    })
    .eq("status", "processing")
    .lte("updated_at", staleBefore);
}

async function claimJob(admin: ReturnType<typeof createClient>, job: QueueJob, now: string) {
  const { data, error } = await admin
    .from("push_notification_queue")
    .update({ status: "processing", updated_at: now })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id,user_id,title,body,data,attempt_count")
    .maybeSingle();

  if (error) throw error;
  return data as QueueJob | null;
}

async function fetchDevices(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin
    .from("push_device_tokens")
    .select("id,token")
    .eq("user_id", userId)
    .eq("active", true)
    .eq("platform", "ios");
  if (error) throw error;
  return (data || []) as DeviceToken[];
}

async function disableInvalidToken(admin: ReturnType<typeof createClient>, deviceId: string, now: string) {
  await admin
    .from("push_device_tokens")
    .update({ active: false, disabled_at: now, updated_at: now })
    .eq("id", deviceId);
}

async function markNoDevice(admin: ReturnType<typeof createClient>, job: QueueJob, now: string) {
  await admin
    .from("push_notification_queue")
    .update({
      status: "no_device",
      processed_at: now,
      updated_at: now,
      last_error: "No active iOS push token registered for this user.",
    })
    .eq("id", job.id);
}

async function markSent(admin: ReturnType<typeof createClient>, job: QueueJob, attempts: number, errors: string[], now: string) {
  await admin
    .from("push_notification_queue")
    .update({
      status: "sent",
      processed_at: now,
      updated_at: now,
      attempt_count: attempts,
      attempts,
      last_error: errors.length ? errors.join(" | ").slice(0, 2000) : null,
    })
    .eq("id", job.id);
}

async function markRetry(admin: ReturnType<typeof createClient>, job: QueueJob, attempts: number, errors: string[], now: string) {
  const exhausted = attempts >= MAX_ATTEMPTS;
  await admin
    .from("push_notification_queue")
    .update({
      status: exhausted ? "failed" : "pending",
      attempt_count: attempts,
      attempts,
      last_error: (errors.join(" | ") || "APNs delivery failed.").slice(0, 2000),
      next_attempt_at: exhausted ? now : backoffDate(attempts),
      processed_at: exhausted ? now : null,
      updated_at: now,
    })
    .eq("id", job.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!authorized(req)) return json({ error: "Unauthorized." }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const key = serviceKey();
    if (!url || !key) return json({ error: "Supabase service configuration is missing." }, 500);

    const admin = createClient(url, key, { auth: { persistSession: false } });
    const now = new Date().toISOString();
    await reviveStaleProcessingJobs(admin, now);

    const { data: dueJobs, error } = await admin
      .from("push_notification_queue")
      .select("id,user_id,title,body,data,attempt_count")
      .eq("status", "pending")
      .lte("next_attempt_at", now)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (error) throw error;

    let claimed = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let noDevice = 0;

    for (const dueJob of (dueJobs || []) as QueueJob[]) {
      const job = await claimJob(admin, dueJob, new Date().toISOString());
      if (!job) {
        skipped += 1;
        continue;
      }
      claimed += 1;

      let devices: DeviceToken[] = [];
      try {
        devices = await fetchDevices(admin, job.user_id);
      } catch (error) {
        failed += 1;
        await markRetry(admin, job, Number(job.attempt_count || 0) + 1, [errorMessage(error)], new Date().toISOString());
        continue;
      }

      if (!devices.length) {
        noDevice += 1;
        await markNoDevice(admin, job, new Date().toISOString());
        continue;
      }

      let anySuccess = false;
      const errors: string[] = [];
      for (const device of devices) {
        try {
          const result = await sendApns(device.token, job.title, job.body, job.data || {});
          if (result.ok) {
            anySuccess = true;
            continue;
          }

          errors.push(`${result.status}:${JSON.stringify(result.details)}`);
          const reason = (result.details as { reason?: string } | null)?.reason || "";
          if ([400, 410].includes(result.status) && INVALID_TOKEN_REASONS.has(reason)) {
            await disableInvalidToken(admin, device.id, new Date().toISOString());
          }
        } catch (error) {
          errors.push(errorMessage(error));
        }
      }

      const attempts = Number(job.attempt_count || 0) + 1;
      if (anySuccess) {
        sent += 1;
        await markSent(admin, job, attempts, errors, new Date().toISOString());
      } else {
        failed += 1;
        await markRetry(admin, job, attempts, errors, new Date().toISOString());
      }
    }

    return json({ processed: dueJobs?.length || 0, claimed, sent, failed, noDevice, skipped });
  } catch (error) {
    return json({ error: errorMessage(error) || "Push dispatch failed." }, 500);
  }
});
