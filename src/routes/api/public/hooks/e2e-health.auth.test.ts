/**
 * The route used to be public: anyone could make it write a log row, mint a
 * magic link, call our own API twice and, on failure, mail support. It now
 * demands the shared secret in `x-e2e-health-secret` before doing anything,
 * compared in constant time, and fails closed when the secret is unset.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { calls } = vi.hoisted(() => ({ calls: { rpc: 0, from: 0 } }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: () => {
      calls.rpc += 1;
      // Counter refuses: proves we got past auth without running the checks.
      return Promise.resolve({ data: 999, error: null });
    },
    from: () => {
      calls.from += 1;
      throw new Error("must not be reached");
    },
  },
}));

const { Route, secretMatches, SECRET_HEADER } = await import("./e2e-health");

type Handler = (ctx: { request: Request }) => Promise<Response>;

function handler(method: "GET" | "POST"): Handler {
  const handlers = (
    Route as unknown as { options?: { server?: { handlers?: Record<string, Handler> } } }
  ).options?.server?.handlers;
  const h = handlers?.[method];
  if (!h) throw new Error(`${method} handler is not registered`);
  return h;
}

const SECRET = "a".repeat(64);

function req(method: "GET" | "POST", headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/public/hooks/e2e-health?by=test", {
    method,
    headers,
  });
}

beforeEach(() => {
  calls.rpc = 0;
  calls.from = 0;
  vi.stubEnv("E2E_HEALTH_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("secretMatches", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(SECRET + "x", SECRET)).toBe(false);
    expect(secretMatches("a".repeat(63), SECRET)).toBe(false);
    expect(secretMatches("", SECRET)).toBe(false);
    expect(secretMatches(null, SECRET)).toBe(false);
  });

  it("never matches when no secret is configured", () => {
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("anything", undefined)).toBe(false);
  });
});

describe.each(["GET", "POST"] as const)("%s /api/public/hooks/e2e-health", (method) => {
  it("returns 401 without the header and does no work", async () => {
    const res = await handler(method)({ request: req(method) });
    expect(res.status).toBe(401);
    expect(calls.rpc + calls.from).toBe(0);
  });

  it("returns 401 with a wrong secret and does no work", async () => {
    const res = await handler(method)({
      request: req(method, { [SECRET_HEADER]: "b".repeat(64) }),
    });
    expect(res.status).toBe(401);
    expect(calls.rpc + calls.from).toBe(0);
  });

  it("returns 503 when the secret is not configured, even with a header", async () => {
    vi.stubEnv("E2E_HEALTH_SECRET", "");
    const res = await handler(method)({ request: req(method, { [SECRET_HEADER]: "" }) });
    expect(res.status).toBe(503);
    expect(calls.rpc + calls.from).toBe(0);
  });

  it("lets the correct secret through to the rate limiter", async () => {
    const res = await handler(method)({ request: req(method, { [SECRET_HEADER]: SECRET }) });
    // The mocked counter is over the limit, so the run stops at 429.
    expect(res.status).toBe(429);
    expect(calls.rpc).toBeGreaterThan(0);
    expect(calls.from).toBe(0);
  });
});
