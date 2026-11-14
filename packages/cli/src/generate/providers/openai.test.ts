import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOpenAiProvider,
  openaiPriceFor,
  openaiRequestParams,
  OPENAI_FALLBACK_PRICE,
  OPENAI_PRICING,
} from "./openai.js";

const req = {
  system: "sys",
  user: "usr",
  jsonSchema: { name: "rows", schema: { type: "object", properties: {} } },
};

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Sends one request through the provider and returns the parsed body it posted. */
async function sentBody(model: string, usage: unknown = {}) {
  const fetchMock = vi.fn(async () =>
    okResponse({ choices: [{ message: { content: '{"rows":[]}' } }], usage }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const out = await createOpenAiProvider({ apiKey: "k", model }).generate(req);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string), out };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai pricing", () => {
  it("prices gpt-6-luna at $0.10 in / $0.50 out per million tokens", () => {
    expect(openaiPriceFor("gpt-6-luna")).toEqual({ input: 0.1, output: 0.5 });
  });

  it("resolves a dated snapshot by longest prefix", () => {
    expect(openaiPriceFor("gpt-6-luna-2026-12-01")).toEqual({ input: 0.1, output: 0.5 });
    expect(openaiPriceFor("gpt-4o-mini-2024-07-18")).toEqual({ input: 0.15, output: 0.6 });
    expect(openaiPriceFor("gpt-4o-2024-11-20")).toEqual({ input: 2.5, output: 10 });
  });

  it("keeps the four models that shut down on 2027-01-14 priced until then", () => {
    for (const id of ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"]) {
      expect(OPENAI_PRICING[id], id).toBeDefined();
    }
  });

  it("returns the fallback for an unknown id, and the fallback is the most expensive entry", () => {
    expect(openaiPriceFor("o9-preview")).toEqual(OPENAI_FALLBACK_PRICE);
    for (const [id, p] of Object.entries(OPENAI_PRICING)) {
      expect(OPENAI_FALLBACK_PRICE.input, id).toBeGreaterThanOrEqual(p.input);
      expect(OPENAI_FALLBACK_PRICE.output, id).toBeGreaterThanOrEqual(p.output);
    }
  });
});

describe("openai request body", () => {
  it("sends reasoning_effort none and temperature 0.7 to gpt-6-luna", async () => {
    // Live check on 2026-11-13: gpt-6-luna returned 400 unsupported_value
    // for temperature 0.7 with no reasoning_effort, and 200 with
    // reasoning_effort "none" plus temperature 0.7 and strict json_schema.
    const { url, body } = await sentBody("gpt-6-luna");
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning_effort).toBe("none");
    expect(body.temperature).toBe(0.7);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "rows", schema: req.jsonSchema.schema, strict: true },
    });
  });

  it("treats a dated gpt-6-luna snapshot the same way", async () => {
    const { body } = await sentBody("gpt-6-luna-2026-12-01");
    expect(body.reasoning_effort).toBe("none");
    expect(body.temperature).toBe(0.7);
  });

  it("leaves the gpt-4o-mini body as 0.3.12 sent it", async () => {
    const { body } = await sentBody("gpt-4o-mini");
    expect(Object.keys(body).sort()).toEqual(
      ["messages", "model", "response_format", "temperature"].sort(),
    );
    expect(body.temperature).toBe(0.7);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("sends neither temperature nor reasoning_effort to other gpt-5 and gpt-6 ids", async () => {
    for (const model of ["gpt-5-mini", "gpt-5.4-nano", "gpt-6.1-sol", "gpt-6-astra"]) {
      const { body } = await sentBody(model);
      expect(body.temperature, model).toBeUndefined();
      expect(body.reasoning_effort, model).toBeUndefined();
    }
    expect(openaiRequestParams("gpt-6.1-terra")).toEqual({});
  });
});

describe("openai usage accounting", () => {
  it("bills completion_tokens as reported, without adding reasoning_tokens again", async () => {
    // Usage block from the live gpt-6-luna response at the default effort on
    // 2026-11-13: total_tokens (167) = prompt_tokens (90) + completion_tokens
    // (77), so the 34 reasoning tokens are already inside completion_tokens.
    const usage = {
      prompt_tokens: 90,
      completion_tokens: 77,
      total_tokens: 167,
      completion_tokens_details: { reasoning_tokens: 34 },
    };
    const { out } = await sentBody("gpt-6-luna", usage);
    expect(out.usage.inputTokens).toBe(90);
    expect(out.usage.outputTokens).toBe(77);
    expect(out.usage.usd).toBeCloseTo((90 / 1e6) * 0.1 + (77 / 1e6) * 0.5, 12);
  });

  it("keeps the `OpenAI <status>:` error prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":{"param":"temperature"}}', { status: 400 })),
    );
    const err = await createOpenAiProvider({ apiKey: "k", model: "gpt-6-luna" })
      .generate(req)
      .catch((e) => e as Error);
    expect((err as Error).message).toMatch(/^OpenAI 400:/);
  });
});
