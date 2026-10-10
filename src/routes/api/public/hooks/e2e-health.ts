/**
 * Daily E2E health check.
 *
 * Exercises the four production-critical subsystems and emails
 * support@satus.sh via Resend only on failure. Every run is recorded in
 * `e2e_health_log`.
 *
 * Called once a day by `.github/workflows/e2e-health.yml` (06:00 UTC),
 * which presents the shared secret in the `x-e2e-health-secret` header.
 * The secret lives in the Vercel env var `E2E_HEALTH_SECRET` and the
 * GitHub Actions secret of the same name. The pg_cron job that used to call
 * this route with a bare `net.http_get` could not send a credential and was
 * retired when the secret landed (2026-10-10).
 *
 * The secret is checked first, with a constant-time compare, before the
 * rate limiter or any other work. No secret configured is a 503 and a
 * missing or wrong secret is a 401, so the route fails closed either way.
 *
 * The handler is not cheap. One run costs a row in `e2e_health_log`, a
 * Supabase admin `generateLink` call, two outbound HTTP requests to our own
 * API, and, when any check fails, an email to support@satus.sh. The per-IP
 * and global rate limits stay behind the secret as a second bound; both
 * fail CLOSED.
 *
 * Checks:
 *   1. license_verify         —POST satus.sh/api/public/license/verify with
 *                                seeded test key, expect { valid: true }.
 *   2. webhook_signature      —POST satus.sh/api/public/payments/webhook
 *                                with no signature, expect 400.
 *   3. auth_magiclink         —supabaseAdmin.auth.admin.generateLink for a
 *                                throwaway address, expect a link back. No
 *                                email is actually sent (generateLink, not
 *                                signInWithOtp).
 *   4. email_queue            —read email_send_state.retry_after_until and
 *                                confirm suppressed_emails answers. Healthy
 *                                when the send state is not paused and the
 *                                suppression table is reachable. No mail-drain
 *                                cron is scheduled, and this check does not
 *                                pretend one ran.
 */

import { createFileRoute } from "@tanstack/react-router";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ORIGIN = "https://satus.sh";
const TEST_KEY = "satus_test_e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0";
const ALERT_TO = "support@satus.sh";
const ALERT_FROM = "satus.sh alerts <alerts@mail.satus.sh>";

type CheckResult = {
  name: string;
  ok: boolean;
  duration_ms: number;
  detail?: unknown;
  error?: string;
};

async function timed<T>(
  name: string,
  fn: () => Promise<{ ok: boolean; detail?: unknown; error?: string }>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const r = await fn();
    return { name, ok: r.ok, duration_ms: Date.now() - start, detail: r.detail, error: r.error };
  } catch (e) {
    return {
      name,
      ok: false,
      duration_ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkLicenseVerify(): Promise<CheckResult> {
  return timed("license_verify", async () => {
    const res = await fetch(`${ORIGIN}/api/public/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: TEST_KEY }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { valid?: boolean; plan?: string };
    if (body.valid !== true) return { ok: false, detail: body, error: "not_valid" };
    return { ok: true, detail: { plan: body.plan } };
  });
}

async function checkWebhookSignature(): Promise<CheckResult> {
  return timed("webhook_signature", async () => {
    // ?env=sandbox so we actually reach the HMAC verifier instead of
    // short-circuiting on the env-query guard (which would 400 regardless).
    const res = await fetch(`${ORIGIN}/api/public/payments/webhook?env=sandbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    // We expect a 4xx because the signature is missing. 2xx or 5xx is a regression.
    if (res.status >= 400 && res.status < 500) {
      return { ok: true, detail: { status: res.status } };
    }
    return { ok: false, error: `unexpected_status_${res.status}` };
  });
}

async function checkAuthMagicLink(): Promise<CheckResult> {
  return timed("auth_magiclink", async () => {
    // generateLink does NOT send an email—it returns the action link
    // synchronously. This confirms the auth API is reachable + signing
    // tokens correctly without polluting any inbox.
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: "e2e+monitor@satus.sh",
    });
    if (error) return { ok: false, error: error.message };
    const link = data?.properties?.action_link;
    if (!link || typeof link !== "string") return { ok: false, error: "no_action_link" };
    return { ok: true, detail: { has_link: true } };
  });
}

async function checkEmailQueue(): Promise<CheckResult> {
  return timed("email_queue", async () => {
    // 1. Rate-limit state must not be in the future
    const { data: state, error: stateErr } = await supabaseAdmin
      .from("email_send_state")
      .select("retry_after_until")
      .eq("id", 1)
      .maybeSingle();
    if (stateErr) return { ok: false, error: `state: ${stateErr.message}` };
    if (state?.retry_after_until && new Date(state.retry_after_until) > new Date()) {
      return { ok: false, error: `rate_limited_until_${state.retry_after_until}` };
    }

    // 2. Confirm the suppression table is reachable (RLS + service-role path
    //    are intact). We don't assert a count—empty is fine on a quiet day.
    const { error: supErr } = await supabaseAdmin
      .from("suppressed_emails")
      .select("email", { count: "exact", head: true });
    if (supErr) return { ok: false, error: `suppressed_emails: ${supErr.message}` };

    return { ok: true, detail: { rate_limited: false, suppressed_reachable: true } };
  });
}

async function sendFailureAlert(checks: CheckResult[]): Promise<void> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error("[e2e] cannot send alert, missing RESEND_API_KEY");
    return;
  }

  const failed = checks.filter((c) => !c.ok);
  const lines = checks.map(
    (c) =>
      `${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(20)}  ${c.duration_ms}ms` +
      (c.error ? `  ${c.error}` : ""),
  );

  const subject = `[satus.sh] E2E FAIL—${failed.map((c) => c.name).join(", ")}`;
  const text = [
    `Daily E2E health check failed at ${new Date().toISOString()}.`,
    "",
    "Results:",
    ...lines,
    "",
    "Failure detail:",
    JSON.stringify(failed, null, 2),
    "",
    "Site:    https://satus.sh",
    "Runbook: tail e2e_health_log, then re-run /api/public/hooks/e2e-health",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: ALERT_FROM,
      to: [ALERT_TO],
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[e2e] Resend alert failed [${res.status}]: ${body}`);
  }
}

async function runE2E(triggeredBy: string) {
  const start = Date.now();
  const checks = await Promise.all([
    checkLicenseVerify(),
    checkWebhookSignature(),
    checkAuthMagicLink(),
    checkEmailQueue(),
  ]);
  const duration_ms = Date.now() - start;
  const failed = checks.filter((c) => !c.ok);
  const status: "pass" | "fail" = failed.length === 0 ? "pass" : "fail";

  await supabaseAdmin.from("e2e_health_log").insert({
    status,
    duration_ms,
    checks: JSON.parse(JSON.stringify(checks)),
    error_message:
      failed.length === 0
        ? null
        : failed.map((c) => `${c.name}: ${c.error ?? "failed"}`).join("; "),
    triggered_by: triggeredBy,
  });

  if (status === "fail") {
    await sendFailureAlert(checks);
  }

  return { status, duration_ms, checks };
}

// Strip internal error strings and detail payloads from public responses.
// Full detail is still persisted to e2e_health_log for internal debugging.
function publicSafe(result: {
  status: "pass" | "fail";
  duration_ms: number;
  checks: CheckResult[];
}) {
  return {
    status: result.status,
    duration_ms: result.duration_ms,
    checks: result.checks.map((c) => ({
      name: c.name,
      ok: c.ok,
      duration_ms: c.duration_ms,
      ...(c.ok ? {} : { error: "internal_error" }),
    })),
  };
}

// Restrict the `by` query parameter to a short, alphanumeric-ish label before
// it is stored in e2e_health_log.triggered_by (unbounded text column).
function sanitizeBy(raw: string | null): string {
  if (!raw) return "manual";
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "manual";
}

// Per-IP and global caps, behind the shared secret. The scheduled job makes
// one call a day, so these are generous for every legitimate caller and
// still bound the blast radius if the secret ever leaks.
const RATE_BUCKET_IP = "e2e_health_ip";
const RATE_LIMIT_IP = 10;
const RATE_WINDOW_IP_SECONDS = 3600;
const RATE_BUCKET_GLOBAL = "e2e_health_global";
const RATE_LIMIT_GLOBAL = 60;
const RATE_WINDOW_GLOBAL_SECONDS = 86400;

function hashIp(ip: string | null): string {
  if (!ip) return "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/**
 * Fails CLOSED, unlike /license/verify. That endpoint fails open because a
 * broken counter there costs a few extra reads; here it costs magic links,
 * outbound requests and mail. A counter that will not answer is a reason to
 * do nothing, and the cost of that is one missed daily sample.
 */
async function overLimit(
  bucket: string,
  key: string,
  windowSeconds: number,
  limit: number,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    p_bucket: bucket,
    p_key: key,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[e2e] rate-limit counter failed—refusing to run", error);
    return true;
  }
  return typeof data === "number" && data > limit;
}

async function rateLimitedResponse(request: Request): Promise<Response | null> {
  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null;

  if (await overLimit(RATE_BUCKET_IP, hashIp(ip), RATE_WINDOW_IP_SECONDS, RATE_LIMIT_IP)) {
    return Response.json({ error: "rate_limited", scope: "ip" }, { status: 429 });
  }
  if (await overLimit(RATE_BUCKET_GLOBAL, "all", RATE_WINDOW_GLOBAL_SECONDS, RATE_LIMIT_GLOBAL)) {
    return Response.json({ error: "rate_limited", scope: "global" }, { status: 429 });
  }
  return null;
}

export const SECRET_HEADER = "x-e2e-health-secret";

/**
 * Constant-time comparison. Both sides are hashed to a fixed 32 bytes first,
 * so neither the content nor the length of the expected secret leaks through
 * timing, and timingSafeEqual never sees buffers of different lengths.
 */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = crypto.createHash("sha256").update(provided, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}

function unauthorizedResponse(request: Request): Response | null {
  const expected = process.env.E2E_HEALTH_SECRET;
  if (!expected) {
    console.error("[e2e] E2E_HEALTH_SECRET is not set; refusing to run");
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  if (!secretMatches(request.headers.get(SECRET_HEADER), expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export const Route = createFileRoute("/api/public/hooks/e2e-health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const denied = unauthorizedResponse(request);
        if (denied) return denied;
        const limited = await rateLimitedResponse(request);
        if (limited) return limited;

        const url = new URL(request.url);
        const result = await runE2E(sanitizeBy(url.searchParams.get("by")));
        return new Response(JSON.stringify(publicSafe(result), null, 2), {
          status: result.status === "pass" ? 200 : 500,
          headers: { "Content-Type": "application/json" },
        });
      },
      POST: async ({ request }) => {
        const denied = unauthorizedResponse(request);
        if (denied) return denied;
        const limited = await rateLimitedResponse(request);
        if (limited) return limited;

        const result = await runE2E("cron");
        return new Response(JSON.stringify(publicSafe(result)), {
          status: result.status === "pass" ? 200 : 500,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
