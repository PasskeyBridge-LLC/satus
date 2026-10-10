/**
 * License verification endpoint—called by the satus CLI on each run
 * (cached locally for ~24h). Public, rate-limited per IP-hash.
 *
 * POST { key: string } → { valid: bool, plan?, expires_at?, reason? }
 *
 * Treats canceled-but-still-within-period as valid (grace window).
 * past_due within the current period is valid billing grace too.
 * Revoked keys are rejected. A period end in the past is expired,
 * whatever the status.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadServerSentry } from "@/instrument.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

// 60 verify calls / 10 min / IP-hash, counted in Postgres so the limit holds
// across Cloudflare Worker isolates (an in-memory Map only counts within one
// isolate, and CF spawns many). The CLI caches verify results for ~24h, so
// this ceiling is generous for legit users and still squashes scripted abuse.
const RATE_BUCKET = "license_verify";
const RATE_WINDOW_SECONDS = 600;
const RATE_LIMIT = 60;

async function rateLimited(key: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    p_bucket: RATE_BUCKET,
    p_key: key,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (error) {
    // Fail open on counter errors—better to serve a few extra verifies than
    // to lock everyone out if the counter table hiccups. Logged for triage,
    // and alerted, because while this branch runs nothing is rate limited.
    console.error("[license/verify] rate-limit counter failed", error);
    await reportVerifyFailure("rate_limit_counter", error);
    return false;
  }
  return typeof data === "number" && data > RATE_LIMIT;
}

export type VerifyFailure = "rate_limit_counter" | "license_lookup";

/** The Postgres/PostgREST error code only (e.g. "42P01"), never the message. */
function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,16}$/.test(code)) return code;
  }
  return "unknown";
}

/**
 * Alert on verify failures through the existing error-only Sentry setup.
 * Warning level, one stable fingerprint per failure kind so repeats group
 * into a single issue, and nothing about the caller: no license key, IP, IP
 * hash, row or error message, only the error code. No-op without a DSN.
 * Alerting must never change the answer, so every failure here is swallowed.
 */
export async function reportVerifyFailure(kind: VerifyFailure, error: unknown): Promise<void> {
  try {
    const sdk = await loadServerSentry();
    if (!sdk) return;
    sdk.captureMessage(`license_verify ${kind} failed`, {
      level: "warning",
      fingerprint: ["license-verify", kind],
      tags: {
        route: "license_verify",
        failure: kind,
        fail_mode: kind === "rate_limit_counter" ? "open" : "closed",
        pg_code: errorCode(error),
      },
    });
  } catch {
    // Swallowed on purpose: monitoring must not take verify down with it.
  }
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/**
 * The CLI's license contract is plan ∈ 'free' | 'pro' | 'team' — the shipped
 * binary literally gates paid caps on `plan === 'pro' || plan === 'team'`.
 * The licenses table stores the Stripe checkout lookup key verbatim
 * (satus_pro_monthly, satus_team_seat_monthly, ...), so normalize at this
 * API boundary. Unrecognized values (e.g. the e2e 'monitor' plan) pass
 * through unchanged, which the CLI treats as unpaid.
 */
function normalizePlan(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.includes("team")) return "team";
  if (raw.includes("pro")) return "pro";
  return raw;
}

const Payload = z.object({
  key: z
    .string()
    .min(20)
    .max(80)
    .regex(/^satus_(live|test)_[a-f0-9]{32}$/),
});

export const Route = createFileRoute("/api/public/license/verify")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json(400, { valid: false, reason: "invalid_json" });
        }

        const parsed = Payload.safeParse(raw);
        if (!parsed.success) {
          return json(400, { valid: false, reason: "invalid_key_format" });
        }

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          null;
        const ipHash = hashIp(ip);
        if (ipHash && (await rateLimited(ipHash))) {
          return json(429, { valid: false, reason: "rate_limited" });
        }

        const { data, error } = await supabaseAdmin
          .from("licenses")
          .select("plan, status, current_period_end, revoked_at")
          .eq("license_key", parsed.data.key)
          .maybeSingle();

        if (error) {
          console.error("[license/verify] lookup failed", error);
          await reportVerifyFailure("license_lookup", error);
          return json(500, { valid: false, reason: "server_error" });
        }
        if (!data) {
          return json(200, { valid: false, reason: "unknown_key" });
        }
        if (data.revoked_at) {
          return json(200, { valid: false, reason: "revoked" });
        }

        const now = Date.now();
        const periodEnd = data.current_period_end
          ? new Date(data.current_period_end).getTime()
          : null;

        // Expiration is checked first so the CLI can distinguish "your
        // subscription period ended, renew it" (expired) from "your
        // subscription is broken on the Stripe side, fix billing"
        // (inactive). A canceled-but-still-in-period license is treated
        // as valid (grace window) and falls through to the success path.
        if (periodEnd !== null && periodEnd <= now) {
          return json(200, { valid: false, reason: "expired" });
        }

        // Active / trialing / past_due (grace) all pass if within period.
        // Canceled also passes while still inside the paid period.
        const goodStatus = ["active", "trialing", "past_due"].includes(data.status);
        const canceledButInPeriod =
          data.status === "canceled" && periodEnd !== null && periodEnd > now;

        if (!(goodStatus || canceledButInPeriod)) {
          return json(200, { valid: false, reason: "inactive" });
        }

        return json(200, {
          valid: true,
          plan: normalizePlan(data.plan),
          expires_at: data.current_period_end,
        });
      },
    },
  },
});
