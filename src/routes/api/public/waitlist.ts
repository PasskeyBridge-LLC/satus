/**
 * Public waitlist intake.
 *
 * POST /api/public/waitlist  { email, tier, note? }
 *
 * Lives under /api/public/* so it bypasses the published-site auth wrapper
 * and can be called by anonymous visitors. Security is enforced in-handler:
 *   - zod validation on shape, length, format
 *   - in-memory per-IP rate limit (best effort; the Worker isolate is short-
 *     lived, so this is a soft cap, not a hard one)
 *   - SHA-256 of the caller IP is stored for abuse triage, never the raw IP
 *   - dedup on (email, tier) via the table's UNIQUE constraint
 *
 * Writes go through `supabaseAdmin` (service role)—RLS still allows anon
 * insert, but using admin avoids depending on a forwarded auth header.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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

const Payload = z.object({
  email: z.string().trim().toLowerCase().min(5).max(254).pipe(z.email()),
  tier: z.enum(["pro", "team"]),
  note: z.string().trim().max(500).optional(),
  source: z.string().trim().max(64).optional(),
});

/**
 * Cross-isolate rate limit: 5 submissions / 10 min / IP-hash, counted in
 * Postgres via `check_rate_limit` so the cap holds even when Cloudflare
 * fans the request out across many short-lived Worker isolates.
 */
const RATE_BUCKET = "waitlist_signup";
const RATE_WINDOW_SECONDS = 600;
const RATE_LIMIT = 5;

async function rateLimited(key: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    p_bucket: RATE_BUCKET,
    p_key: key,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (error) {
    // Fail open: a transient counter error shouldn't block a legit signup.
    console.error("[waitlist] rate-limit counter failed", error);
    return false;
  }
  return typeof data === "number" && data > RATE_LIMIT;
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export const Route = createFileRoute("/api/public/waitlist")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async () =>
        new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "POST, OPTIONS", ...CORS },
        }),

      POST: async ({ request }) => {
        // Parse body defensively; malformed JSON should not crash the route.
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json(400, { error: "invalid_json" });
        }

        const parsed = Payload.safeParse(raw);
        if (!parsed.success) {
          return json(400, {
            error: "invalid_payload",
            issues: parsed.error.flatten().fieldErrors,
          });
        }

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          null;
        const ipHash = hashIp(ip);

        if (ipHash && (await rateLimited(ipHash))) {
          return json(429, { error: "rate_limited" });
        }

        const ua = request.headers.get("user-agent")?.slice(0, 512) ?? null;
        const { email, tier, note, source } = parsed.data;

        const { error } = await supabaseAdmin.from("waitlist_signups").insert({
          email,
          tier,
          note: note ?? null,
          source: source ?? null,
          user_agent: ua,
          ip_hash: ipHash,
        });

        // Treat duplicate (email, tier) as success—same intent, idempotent.
        if (error && error.code !== "23505") {
          console.error("[waitlist] insert failed", error);
          return json(500, { error: "server_error" });
        }

        return json(200, { ok: true, tier });
      },
    },
  },
});
