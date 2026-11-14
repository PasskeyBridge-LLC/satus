/**
 * OpenAI provider. Calls the chat-completions endpoint directly with
 * `fetch` (no SDK dep) and uses native structured output via
 * `response_format: json_schema` with `strict: true`. Override the
 * endpoint with `OPENAI_BASE_URL` to point at compatible providers
 * (Together, Groq, a local proxy, etc.).
 *
 * Cost tracking: per-response usage is converted to a USD estimate using
 * a small built-in price table. The estimate drives the `--max-cost`
 * guardrail; it is not accounting. Rates are last-verified values and
 * may drift — the README states this clearly.
 */
import type { Provider, ProviderRequest, ProviderResponse } from "./types.js";

const DEFAULT_BASE = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

/**
 * USD per million tokens, keyed by model-id prefix (longest prefix wins).
 * Last verified: 2026-11-13 against OpenAI's model pages.
 *
 * gpt-4o-mini, gpt-4o, gpt-4.1-mini and gpt-4.1 shut down on 2027-01-14
 * (OpenAI deprecations page, announced 2026-10-14). They stay priced until
 * then so a user who pins one with --model still gets a cost estimate.
 */
export const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1": { input: 2, output: 8 },
};

/**
 * Applied to any model id not matched above. Set to the most expensive
 * entry in the table: an unpriced model can then only cause `--max-cost`
 * to abort early, never to overshoot silently. The previous value
 * ($1/$3) was *below* three of the four priced models, so unlisted ids
 * were under-billed — the wrong direction for a budget guardrail. This is
 * a deliberate upper bound, not a claim about any particular model.
 */
export const OPENAI_FALLBACK_PRICE = { input: 2.5, output: 10 };

/**
 * Longest matching prefix wins, so `gpt-4o-mini` cannot be shadowed by
 * `gpt-4o` regardless of object key order.
 */
export function openaiPriceFor(model: string) {
  let best: { input: number; output: number } | undefined;
  let bestLen = -1;
  for (const [key, price] of Object.entries(OPENAI_PRICING)) {
    if (model.startsWith(key) && key.length > bestLen) {
      best = price;
      bestLen = key.length;
    }
  }
  return best ?? OPENAI_FALLBACK_PRICE;
}

/**
 * Sampling and reasoning parameters sent with each request, by model id.
 *
 * - gpt-6-luna: `reasoning_effort: "none"` and `temperature: 0.7`. Checked
 *   live on 2026-11-13 against /v1/chat/completions with strict json_schema:
 *   temperature 0.7 without reasoning_effort returned 400 unsupported_value
 *   ("Only the default (1) value is supported"); with reasoning_effort
 *   "none" it returned 200. "none" also means no reasoning-token spend on a
 *   structured-output job, the same reason the xAI default is a
 *   non-reasoning model.
 * - Other gpt-5 and gpt-6 ids: neither parameter. These models accept only
 *   the default temperature unless reasoning effort is "none", and not all
 *   of them accept "none" (OpenAI's GPT-6 migration guide lists GPT-6 Astra
 *   and GPT-6.1 Sol as returning 400 for it).
 * - Everything else (gpt-4o, gpt-4.1, ...): `temperature: 0.7`, as in 0.3.12.
 */
export function openaiRequestParams(model: string): {
  temperature?: number;
  reasoning_effort?: "none";
} {
  if (/^gpt-6-luna/i.test(model)) return { reasoning_effort: "none", temperature: 0.7 };
  if (/^gpt-[56]/i.test(model)) return {};
  return { temperature: 0.7 };
}

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
}

export function createOpenAiProvider(opts: OpenAiProviderOptions): Provider {
  const { apiKey, model } = opts;
  const price = openaiPriceFor(model);
  return {
    id: "openai",
    model,
    rates: { inputPerMTok: price.input, outputPerMTok: price.output },
    async generate<T>(req: ProviderRequest): Promise<ProviderResponse<T>> {
      const body: Record<string, unknown> = {
        model,
        ...openaiRequestParams(model),
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

      const res = await fetch(`${DEFAULT_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`);
      }

      const payload = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenAI returned no content");

      let parsed: T;
      try {
        parsed = JSON.parse(content) as T;
      } catch (err) {
        throw new Error(`Failed to parse model JSON: ${(err as Error).message}`);
      }

      // completion_tokens already includes reasoning tokens: in the live
      // gpt-6-luna response of 2026-11-13, total_tokens equalled
      // prompt_tokens + completion_tokens while completion_tokens_details
      // listed 34 reasoning tokens. Adding them again would double-bill.
      // (xAI reports reasoning tokens outside completion_tokens; see xai.ts.)
      const inputTokens = payload.usage?.prompt_tokens ?? 0;
      const outputTokens = payload.usage?.completion_tokens ?? 0;
      const usd =
        (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;

      return { data: parsed, usage: { inputTokens, outputTokens, usd } };
    },
  };
}
