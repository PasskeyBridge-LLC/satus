/**
 * Verify fails OPEN on the limiter when the rate-limit counter errors, by
 * design: throttling is skipped, then the licenses table still decides
 * validity. An unknown key stays not-valid. Counter and lookup failures
 * log {kind, fail_mode, pg_code} and raise a Sentry warning with a stable
 * fingerprint and no personal data.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, captureMessage } = vi.hoisted(() => ({
  state: {
    rpcError: null as { code: string; message: string } | null,
    lookupError: null as { code: string; message: string } | null,
    sdk: true,
  },
  captureMessage: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: () =>
      Promise.resolve(
        state.rpcError ? { data: null, error: state.rpcError } : { data: 1, error: null },
      ),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              state.lookupError
                ? { data: null, error: state.lookupError }
                : { data: null, error: null },
            ),
        }),
      }),
    }),
  },
}));

vi.mock("@/instrument.server", () => ({
  loadServerSentry: () => Promise.resolve(state.sdk ? { captureMessage } : null),
}));

const { Route } = await import("./verify");

type PostHandler = (ctx: { request: Request }) => Promise<Response>;
const POST = (Route as unknown as { options: { server: { handlers: { POST: PostHandler } } } })
  .options.server.handlers.POST;

const KEY = "satus_live_" + "cd".repeat(16);
const IP = "203.0.113.7";

function post() {
  return POST({
    request: new Request("http://localhost/api/public/license/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": IP },
      body: JSON.stringify({ key: KEY }),
    }),
  });
}

beforeEach(() => {
  state.rpcError = null;
  state.lookupError = null;
  state.sdk = true;
  captureMessage.mockReset();
  vi.spyOn(console, "error")
    .mockImplementation(() => {})
    .mockClear();
});

describe("verify alerting", () => {
  it("keeps an unknown key not-valid when the limiter errors, and logs pg_code only", async () => {
    state.rpcError = { code: "42P01", message: `relation for ${IP} does not exist` };
    const errorSpy = vi.mocked(console.error);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false, reason: "unknown_key" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("[license/verify] rate-limit counter failed");
    expect(errorSpy.mock.calls[0][1]).toEqual({
      kind: "rate_limit_counter",
      fail_mode: "open",
      pg_code: "42P01",
    });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(IP);
    expect(logged).not.toContain("does not exist");

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, ctx] = captureMessage.mock.calls[0];
    expect(message).toBe("license_verify rate_limit_counter failed");
    expect(ctx).toMatchObject({
      level: "warning",
      fingerprint: ["license-verify", "rate_limit_counter"],
      tags: { failure: "rate_limit_counter", fail_mode: "open", pg_code: "42P01" },
    });
  });

  it("raises a warning on a lookup failure and still answers 500", async () => {
    state.lookupError = { code: "57014", message: "canceling statement" };
    const errorSpy = vi.mocked(console.error);
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ valid: false, reason: "server_error" });
    expect(errorSpy.mock.calls[0][1]).toEqual({
      kind: "license_lookup",
      fail_mode: "closed",
      pg_code: "57014",
    });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0][1]).toMatchObject({
      level: "warning",
      fingerprint: ["license-verify", "license_lookup"],
      tags: { fail_mode: "closed", pg_code: "57014" },
    });
  });

  it("sends no key, IP, IP hash or error message", async () => {
    state.rpcError = { code: "42P01", message: `boom ${IP} ${KEY}` };
    await post();
    const sent = JSON.stringify(captureMessage.mock.calls);
    expect(sent).not.toContain(KEY);
    expect(sent).not.toContain(KEY.slice(-8));
    expect(sent).not.toContain(IP);
    expect(sent).not.toMatch(/[a-f0-9]{32}/);
    expect(sent).not.toContain("boom");
  });

  it("does not alert on a healthy request", async () => {
    await post();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("answers normally when Sentry is not configured or throws", async () => {
    state.rpcError = { code: "42P01", message: "x" };
    state.sdk = false;
    expect((await post()).status).toBe(200);
    state.sdk = true;
    captureMessage.mockImplementation(() => {
      throw new Error("sentry down");
    });
    expect((await post()).status).toBe(200);
  });
});
