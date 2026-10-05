import { afterEach, describe, expect, it, vi } from "vitest";
import { createXaiProvider, xaiPriceFor, xaiSupportsTemperature } from "./xai.js";
import { classifyError } from "../telemetry.js";
import { ConfigSchema } from "../config.js";
import { DEFAULT_MODELS, PROVIDER_ENV, resolveProviderId } from "../../commands/generate.js";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("xai provider", () => {
  it("posts an OpenAI-style strict json_schema request to api.x.ai", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        choices: [{ message: { content: '{"rows":[1,2]}' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("XAI_BASE_URL", "");

    const p = createXaiProvider({ apiKey: "test-key", model: "grok-4.20-0309-non-reasoning" });
    const out = await p.generate<{ rows: number[] }>(req);

    expect(p.id).toBe("xai");
    expect(out.data).toEqual({ rows: [1, 2] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("grok-4.20-0309-non-reasoning");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.temperature).toBe(0.7);
    // 1000 in @ $1.25/M + 500 out @ $2.50/M
    expect(out.usage.usd).toBeCloseTo(0.00125 + 0.00125, 10);
  });

  it("honours XAI_BASE_URL with or without a version segment", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ choices: [{ message: { content: "{}" } }], usage: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("XAI_BASE_URL", "http://localhost:9999/");
    await createXaiProvider({ apiKey: "k", model: "grok-4.3" }).generate(req);
    expect(fetchMock.mock.calls[0][0 as never]).toBe("http://localhost:9999/v1/chat/completions");
  });

  it("counts reasoning tokens toward the budget and omits temperature on reasoning models", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        choices: [{ message: { content: "{}" } }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 100,
          completion_tokens_details: { reasoning_tokens: 900 },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await createXaiProvider({ apiKey: "k", model: "grok-4.3" }).generate(req);
    expect(out.usage.outputTokens).toBe(1000);
    expect(out.usage.usd).toBeCloseTo(0.0025, 10);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.temperature).toBeUndefined();
  });

  it("raises an `xAI <status>:` error that telemetry reduces to its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 429 })),
    );
    const p = createXaiProvider({ apiKey: "k", model: "grok-4.20-0309-non-reasoning" });
    const err = await p.generate(req).catch((e) => e as Error);
    expect((err as Error).message).toMatch(/^xAI 429:/);
    expect(classifyError(err)).toBe("provider_http_429");
    expect(classifyError(new Error("xAI returned no content"))).toBe("provider_empty");
  });

  it("prices by longest prefix and falls back high for unknown models", () => {
    expect(xaiPriceFor("grok-4.20-0309-non-reasoning")).toEqual({ input: 1.25, output: 2.5 });
    expect(xaiPriceFor("grok-4.7")).toEqual({ input: 2, output: 6 });
    expect(xaiPriceFor("grok-9-future")).toEqual({ input: 2.5, output: 10 });
    expect(xaiSupportsTemperature("grok-4.20-0309-non-reasoning")).toBe(true);
    expect(xaiSupportsTemperature("grok-4.20-0309-reasoning")).toBe(false);
  });
});

describe("provider selection with xai", () => {
  it("accepts --provider xai and keeps the existing defaults", () => {
    expect(resolveProviderId("xai", undefined)).toBe("xai");
    expect(DEFAULT_MODELS).toEqual({
      openai: "gpt-4o-mini",
      anthropic: "claude-haiku-4-5",
      xai: "grok-4.20-0309-non-reasoning",
    });
    expect(PROVIDER_ENV.xai).toBe("XAI_API_KEY");
    expect(() => resolveProviderId("grok", undefined)).toThrow(/openai \| anthropic \| xai/);
  });

  it("auto-detects xai only when no OpenAI or Anthropic key is set", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "x");
    expect(resolveProviderId(undefined, undefined)).toBe("xai");

    vi.stubEnv("OPENAI_API_KEY", "o");
    expect(resolveProviderId(undefined, undefined)).toBe("openai");

    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    expect(resolveProviderId(undefined, undefined)).toBe("anthropic");

    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "");
    expect(resolveProviderId(undefined, undefined)).toBe("openai");
  });

  it("accepts provider: xai in satus.config.json", () => {
    expect(ConfigSchema.parse({ provider: "xai" }).provider).toBe("xai");
  });
});
