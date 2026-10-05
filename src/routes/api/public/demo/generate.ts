/**
 * In-browser demo: server-side LLM proxy.
 *
 * POST /api/public/demo/generate  { profile, tables: [...] }
 *
 * The /demo page runs the visitor's DDL in PGlite (WASM Postgres in the
 * browser), introspects it there, and sends a compact schema description
 * here. This endpoint makes ONE xAI (Grok) call on our key and returns
 * generated rows; the browser inserts them into PGlite, injecting FK
 * values client-side from actually-inserted parent PKs (same semantics
 * as the CLI runner — FK columns are never sent to the model).
 *
 * Abuse posture (this spends our money, so hard caps everywhere):
 *   - zod caps: ≤6 tables, ≤14 generatable columns/table, ≤5 rows/table
 *   - per-IP rate limit: 10 runs / hour  (check_rate_limit, Postgres)
 *   - global rate limit: 300 runs / day across all visitors
 *   - max_tokens bounded; model pinned to grok-4.20-0309-non-reasoning
 *   - no user text is echoed into the prompt except identifier names and
 *     enum labels, all zod-bounded in length and charset
 *
 * Reads XAI_API_KEY. When it is not set the endpoint returns 503 and the
 * demo page says so honestly instead of pretending. The call goes to
 * xAI's OpenAI-style chat completions endpoint with a forced function
 * call, the same structured-output shape the CLI's providers use.
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

/** Postgres identifier: bounded, conservative charset. */
const ident = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_$]*$/);

const Column = z.object({
  name: ident,
  /** information_schema.data_type, e.g. "text", "integer", "numeric". */
  dataType: z.string().min(1).max(40),
  /** pg udt name, e.g. "int4", "uuid", or the enum type name. */
  udtName: z.string().min(1).max(63),
  nullable: z.boolean(),
  maxLength: z.number().int().positive().max(10_000).nullable(),
  /** Present when the column is a Postgres enum. */
  enumValues: z.array(z.string().min(1).max(64)).max(24).optional(),
});

const Table = z.object({
  name: ident,
  /** Columns the model should fill (no PKs-with-defaults, no FKs, no generated). */
  columns: z.array(Column).min(1).max(14),
});

const Payload = z.object({
  profile: z.enum(["saas", "ecommerce", "b2b"]),
  rows: z.number().int().min(1).max(5),
  tables: z.array(Table).min(1).max(6),
});

const RATE_BUCKET_IP = "demo_generate_ip";
const RATE_LIMIT_IP = 10; // per hour per IP-hash
const RATE_BUCKET_GLOBAL = "demo_generate_global";
const RATE_LIMIT_GLOBAL = 300; // per day, all visitors

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
    // Fail CLOSED here (unlike the waitlist): this endpoint spends money.
    console.error("[demo] rate-limit counter failed", error);
    return true;
  }
  return typeof data === "number" && data > limit;
}

function hashIp(ip: string | null): string {
  if (!ip) return "unknown";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

const PROFILE_HINTS: Record<string, string> = {
  saas: "B2B SaaS: startup company names, workplace emails, job titles, plan-style enums, dates in the last 18 months.",
  ecommerce:
    "Consumer e-commerce: real-sounding product names, prices ending .99/.49/.00 between 9.99 and 299.99, US/UK/DE/FR/JP customer names, statuses biased toward fulfilled.",
  b2b: "B2B services: mid-market company names, contract values $5k–$250k, PO numbers, NET-30 terms. No consumer language.",
};

const DEMO_MODEL = "grok-4.20-0309-non-reasoning";

function xaiBase(): string {
  const raw = process.env.XAI_BASE_URL ?? "https://api.x.ai/v1";
  const trimmed = raw.replace(/\/+$/, "");
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/** JSON schema the model is forced to fill via tool-use. */
function buildToolSchema(tables: z.infer<typeof Payload>["tables"], rows: number) {
  const properties: Record<string, unknown> = {};
  for (const t of tables) {
    const colProps: Record<string, unknown> = {};
    for (const c of t.columns) {
      if (c.enumValues && c.enumValues.length > 0) {
        colProps[c.name] = { enum: c.enumValues };
      } else if (/int|numeric|float|double|real|decimal/i.test(c.dataType)) {
        colProps[c.name] = { type: c.nullable ? ["number", "null"] : "number" };
      } else if (/bool/i.test(c.dataType)) {
        colProps[c.name] = { type: c.nullable ? ["boolean", "null"] : "boolean" };
      } else {
        colProps[c.name] = {
          type: c.nullable ? ["string", "null"] : "string",
          ...(c.maxLength ? { maxLength: c.maxLength } : {}),
        };
      }
    }
    properties[t.name] = {
      type: "array",
      minItems: rows,
      maxItems: rows,
      items: {
        type: "object",
        properties: colProps,
        required: t.columns.map((c) => c.name),
        additionalProperties: false,
      },
    };
  }
  return {
    type: "object",
    properties,
    required: tables.map((t) => t.name),
    additionalProperties: false,
  };
}

export const Route = createFileRoute("/api/public/demo/generate")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }) => {
        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) {
          return json(503, { error: "demo_unavailable" });
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json(400, { error: "invalid_json" });
        }
        const parsed = Payload.safeParse(raw);
        if (!parsed.success) {
          return json(400, { error: "invalid_payload" });
        }

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          null;

        if (await overLimit(RATE_BUCKET_IP, hashIp(ip), 3600, RATE_LIMIT_IP)) {
          return json(429, { error: "rate_limited", scope: "ip" });
        }
        if (await overLimit(RATE_BUCKET_GLOBAL, "all", 86400, RATE_LIMIT_GLOBAL)) {
          return json(429, { error: "rate_limited", scope: "global" });
        }

        const { tables, rows, profile } = parsed.data;
        const toolSchema = buildToolSchema(tables, rows);

        const system =
          `You generate realistic seed data. ${PROFILE_HINTS[profile]} ` +
          `Return ONLY data conforming to the provided JSON schema. Vary values; ` +
          `never repeat row 1 for row N. Unique-looking columns (emails, skus, names) ` +
          `must be distinct within each table.`;

        const user =
          `Generate exactly ${rows} rows for each of these Postgres tables: ` +
          tables.map((t) => t.name).join(", ") +
          `. Column names, types, and allowed enum values are encoded in the tool schema.`;

        const res = await fetch(`${xaiBase()}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: DEMO_MODEL,
            max_tokens: 4096,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "emit_rows",
                  description: "Emit the requested structured rows.",
                  parameters: toolSchema,
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "emit_rows" } },
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("[demo] xai error", res.status, text.slice(0, 300));
          return json(502, { error: "generation_failed" });
        }

        const payload = (await res.json()) as {
          choices?: Array<{
            message?: {
              tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
            };
          }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const call = payload.choices?.[0]?.message?.tool_calls?.find(
          (c) => c.function?.name === "emit_rows",
        );
        let rowsOut: unknown;
        try {
          rowsOut = call?.function?.arguments ? JSON.parse(call.function.arguments) : undefined;
        } catch {
          rowsOut = undefined;
        }
        if (!rowsOut || typeof rowsOut !== "object") {
          console.error("[demo] xai returned no usable emit_rows call", DEMO_MODEL);
          return json(502, { error: "generation_failed" });
        }

        return json(200, {
          tables: rowsOut,
          usage: {
            input_tokens: payload.usage?.prompt_tokens ?? 0,
            output_tokens: payload.usage?.completion_tokens ?? 0,
          },
        });
      },
    },
  },
});
