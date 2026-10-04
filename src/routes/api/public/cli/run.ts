/**
 * CLI run telemetry sink. Called by `satus generate` (fire-and-forget) after
 * each run finishes. Records how much was generated, the model used, and the
 * spend so we can validate end-to-end runs and see real usage data in the
 * `public.satus_runs` table.
 *
 * POST { id?, status, profile, provider, model, table_count, total_rows,
 *        total_cost_usd, input_tokens, output_tokens, duration_ms,
 *        error_class?, cli_version, environment }
 *
 * ## Legacy fields are accepted and discarded
 *
 * The published privacy promise says satus never sends table names, column
 * names, the schema name, or row data. CLI versions 0.2.0 through 0.3.6 did
 * send `tables` (every table name), `target_schema`, and `error_message`
 * (raw error text, which embeds identifiers and — for unique violations —
 * actual row values). v0.3.7 stops sending them, but older CLIs are already
 * installed and will keep sending them for as long as they are in use.
 *
 * So the sink drops them here too: the zod schema still *accepts* the three
 * legacy keys (rejecting them would 400 every older client and break a
 * contract they were built against), and `toRow` then strips them so they
 * are never written. Keeping the promise has to hold on the receiving end
 * as well, or it only holds for users who upgrade.
 *
 * Public + bounded payload. No auth: the CLI runs on customer machines
 * where we can't ship secrets. Tight zod validation, a fail-closed
 * per-IP-hash rate limit (`cli_run`, 60/hour), and small INSERTs only.
 */

import { createFileRoute } from "@tanstack/react-router";
import { TELEMETRY_PROVIDERS } from "@/lib/telemetry-providers";
import { z } from "zod";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Two posts per generate (running, then success or failed). 60/hour is
// thirty generates from one address: above interactive use, still a bound
// on a script that would otherwise fill `satus_runs`. Counted in Postgres
// via `check_rate_limit`, after the body validates and before any write,
// so a malformed payload does not spend the budget. Fails closed: a
// counter that errors or returns a non-number refuses the insert. A public
// sink that fails open is how the table gets flooded when Postgres hiccups.
const RATE_BUCKET = "cli_run";
const RATE_WINDOW_SECONDS = 3600;
const RATE_LIMIT = 60;

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

const TableReport = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_]+$/),
  rows_generated: z.number().int().min(0).max(1_000_000),
});

/**
 * Keys accepted from pre-0.3.7 clients purely so they receive a 200, then
 * stripped by `toRow` before the insert. Never persisted, never logged.
 */
const LEGACY_DROPPED_KEYS = ["tables", "target_schema", "error_message", "license_key"] as const;

const RunSchema = z.object({
  id: z.string().uuid().optional(),
  status: z.enum(["running", "success", "failed"]),
  profile: z.string().min(1).max(32).optional(),
  // v0.3.0 (optional, backward-compatible with v0.2.x clients which omit it).
  // "xai" added 2026-09-26 for the CLI's xai provider; unknown values 400.
  provider: z.enum(TELEMETRY_PROVIDERS).optional(),
  model: z.string().min(1).max(64).optional(),
  // v0.3.7: replaces the per-table `tables` array.
  table_count: z.number().int().min(0).max(10_000).optional(),
  total_rows: z.number().int().min(0).max(10_000_000).optional(),
  total_cost_usd: z.number().min(0).max(10_000).optional(),
  // v0.3.0 token counts (optional). Bounded to prevent abuse but generous.
  input_tokens: z.number().int().min(0).max(1_000_000_000).optional(),
  output_tokens: z.number().int().min(0).max(1_000_000_000).optional(),
  duration_ms: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .optional(),
  // v0.3.7: fixed-vocabulary failure class; replaces free-text error_message.
  error_class: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),
  cli_version: z.string().min(1).max(32).optional(),
  environment: z.enum(["dev", "live"]).default("dev"),

  // --- Legacy, accepted then discarded. See the header. ---
  license_key: z.string().min(8).max(128).optional(),
  target_schema: z.string().min(1).max(64).optional(),
  tables: z.array(TableReport).max(200).optional(),
  error_message: z.string().max(2_000).optional(),
  // v0.3.3 opt-in telemetry (all optional; older CLIs never send these).
  // Fingerprint is a 64-char lowercase hex SHA-256; anything else is
  // rejected before it lands in the DB.
  schema_fingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  validator_class: z.string().min(1).max(64).optional(),
  invocation_sequence: z.array(z.string().min(1).max(32)).max(16).optional(),
});

/**
 * Build the DB row from a validated payload, dropping every legacy
 * identifying field. Written as an explicit delete over a copy rather than
 * a hand-listed allow-list so a future column added to both the CLI and
 * the table cannot be silently forgotten here — while the four keys we
 * refuse to store stay named in one place.
 */
function toRow(data: z.infer<typeof RunSchema>): Record<string, unknown> {
  const row: Record<string, unknown> = { ...data };
  for (const key of LEGACY_DROPPED_KEYS) delete row[key];
  row.finished_at = data.status === "running" ? null : new Date().toISOString();
  return row;
}

function hashIp(ip: string | null): string {
  const value = ip && ip.length > 0 ? ip : "unknown";
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function clientIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

async function overLimit(ipHash: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_rate_limit", {
    p_bucket: RATE_BUCKET,
    p_key: ipHash,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (error || typeof data !== "number") {
    console.error("[cli/run] rate-limit counter failed", error ?? data);
    return true;
  }
  return data > RATE_LIMIT;
}

export const Route = createFileRoute("/api/public/cli/run")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json(400, { ok: false, reason: "invalid_json" });
        }
        const parsed = RunSchema.safeParse(body);
        if (!parsed.success) {
          return json(400, { ok: false, reason: "invalid_payload", issues: parsed.error.issues });
        }
        if (await overLimit(hashIp(clientIp(request)))) {
          return json(429, { ok: false, reason: "rate_limited" });
        }
        const row = toRow(parsed.data);

        // Upsert by id when the CLI provides one (so a single run shows up
        // as one row across "running" -> "success/failed" updates).
        if (parsed.data.id) {
          const { error } = await supabaseAdmin
            .from("satus_runs")
            .upsert(row, { onConflict: "id" });
          if (error) return json(500, { ok: false, reason: "db_error", detail: error.message });
          return json(200, { ok: true, id: parsed.data.id });
        }

        const { data, error } = await supabaseAdmin
          .from("satus_runs")
          .insert(row)
          .select("id")
          .single();
        if (error) return json(500, { ok: false, reason: "db_error", detail: error.message });
        return json(200, { ok: true, id: data.id });
      },
    },
  },
});
