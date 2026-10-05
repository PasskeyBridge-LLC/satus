/**
 * xAI (Grok) provider. Calls xAI's OpenAI-style chat-completions endpoint
 * (`https://api.x.ai/v1/chat/completions`) directly with `fetch` and uses
 * native structured output via `response_format: json_schema` with
 * `strict: true`, the same request shape as the OpenAI provider. Override
 * the endpoint with `XAI_BASE_URL` to point at a proxy or test server.
 *
 * Kept as its own provider rather than "OpenAI with a base URL" for three
 * reasons: it reads its own key (`XAI_API_KEY`), it has its own price
 * table, and reasoning Grok models bill reasoning tokens that xAI reports
 * outside `completion_tokens` (in `completion_tokens_details.
 * reasoning_tokens`). The `--max-cost` meter counts both, so a reasoning
 * model cannot overshoot the budget by thinking.
 *
 * Cost tracking is an estimate that drives the `--max-cost` guardrail; it
 * is not accounting.
 */
import type { Provider, ProviderRequest, ProviderResponse } from "./types.js";

function normalizeBase(raw: string | undefined): string {
  if (!raw) return "https://api.x.ai/v1";
  const trimmed = raw.replace(/\/+$/, "");
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/**
 * USD per million tokens, keyed by model-id prefix (longest prefix wins).
 * Last verified: 2026-09 against docs.x.ai pricing (prompts under 200k
 * tokens).
 */
const PRICING: Record<string, { input: number; output: number }> = {
  "grok-4.20": { input: 1.25, output: 2.5 },
  "grok-4.3": { input: 1.25, output: 2.5 },
  "grok-4.5": { input: 2, output: 6 },
  "grok-4.6": { input: 2, output: 6 },
  "grok-4.7": { input: 2, output: 6 },
  "grok-build": { input: 1, output: 2 },
  "grok-code-fast": { input: 1, output: 2 },
};

/**
 * Applied to any model id not matched above. Deliberately above every
 * priced entry, so an unpriced model can only make `--max-cost` abort
 * early, never overshoot silently. Same rule as the OpenAI provider.
 */
const FALLBACK_PRICE = { input: 2.5, output: 10 };

export function xaiPriceFor(model: string) {
  let best: { input: number; output: number } | undefined;
  let bestLen = -1;
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = price;
      bestLen = key.length;
    }
  }
  return best ?? FALLBACK_PRICE;
}

/**
 * xAI's docs say temperature "may not work well with reasoning models".
 * Send it only to models whose id says they are non-reasoning; everything
 * else uses the model's own default.
 */
export function xaiSupportsTemperature(model: string): boolean {
  return /non-reasoning/i.test(model);
}

export interface XaiProviderOptions {
  apiKey: string;
  model: string;
}

export function createXaiProvider(opts: XaiProviderOptions): Provider {
  const { apiKey, model } = opts;
  const price = xaiPriceFor(model);
  return {
    id: "xai",
    model,
    rates: { inputPerMTok: price.input, outputPerMTok: price.output },
    async generate<T>(req: ProviderRequest): Promise<ProviderResponse<T>> {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: req.jsonSchema.name,
            schema: req.jsonSchema.schema,
            strict: true,
          },
        },
      };
      if (xaiSupportsTemperature(model)) {
        body.temperature = 0.7;
      }

      // Read at call time so XAI_BASE_URL can be set after import.
      const base = normalizeBase(process.env.XAI_BASE_URL);
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`xAI ${res.status}: ${text.slice(0, 500)}`);
      }

      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };

      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("xAI returned no content");

      let parsed: T;
      try {
        parsed = JSON.parse(content) as T;
      } catch (err) {
        throw new Error(`Failed to parse model JSON: ${(err as Error).message}`);
      }

      const inputTokens = payload.usage?.prompt_tokens ?? 0;
      const outputTokens =
        (payload.usage?.completion_tokens ?? 0) +
        (payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0);
      const usd =
        (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;

      return { data: parsed, usage: { inputTokens, outputTokens, usd } };
    },
  };
}
