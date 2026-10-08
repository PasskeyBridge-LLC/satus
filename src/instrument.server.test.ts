/**
 * The server SDK must not load at all when SENTRY_DSN is empty: no import
 * of @sentry/tanstackstart-react, no init, no fetch wrapper, and the global
 * middlewares only call next().
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const sdkLoaded = vi.fn();
const initSentry = vi.fn();
const wrapFetchWithSentry = vi.fn((entry: { fetch: unknown }) => {
  const inner = entry.fetch as (...args: unknown[]) => Promise<Response>;
  return {
    fetch: async (...args: unknown[]) => {
      const response = await inner(...args);
      return new Response(await response.text(), { headers: { "x-wrapped": "1" } });
    },
  };
});
const requestServer = vi.fn(async ({ next }: { next: () => Promise<unknown> }) => next());
const functionServer = vi.fn(async ({ next }: { next: () => Promise<unknown> }) => next());

vi.mock("@sentry/tanstackstart-react", () => {
  sdkLoaded();
  return {
    wrapFetchWithSentry,
    sentryGlobalRequestMiddleware: { options: { server: requestServer } },
    sentryGlobalFunctionMiddleware: { options: { server: functionServer } },
  };
});

vi.mock("./lib/sentry", () => ({ initSentry }));

const handler = vi.fn(async () => new Response("ok"));
const request = new Request("https://satus.sh/");

describe("server Sentry bootstrap", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("never imports the SDK when SENTRY_DSN is empty", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { loadServerSentry, withServerSentry, runSentryMiddleware } =
      await import("./instrument.server");

    expect(await loadServerSentry()).toBeNull();

    const response = await withServerSentry(handler)(request, {}, {});
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("x-wrapped")).toBeNull();

    const next = vi.fn(async () => "next-result");
    expect(await runSentryMiddleware("request", { next })).toBe("next-result");
    expect(await runSentryMiddleware("function", { next })).toBe("next-result");
    expect(next).toHaveBeenCalledTimes(2);

    expect(sdkLoaded).not.toHaveBeenCalled();
    expect(initSentry).not.toHaveBeenCalled();
    expect(wrapFetchWithSentry).not.toHaveBeenCalled();
  });

  it("inits once and wraps fetch and both middlewares when SENTRY_DSN is set", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.us.sentry.io/1");
    const { withServerSentry, runSentryMiddleware } = await import("./instrument.server");

    const fetch = withServerSentry(handler);
    const first = await fetch(request, {}, {});
    await fetch(request, {}, {});
    expect(first.headers.get("x-wrapped")).toBe("1");

    const next = vi.fn(async () => "next-result");
    expect(await runSentryMiddleware("request", { next })).toBe("next-result");
    expect(await runSentryMiddleware("function", { next })).toBe("next-result");

    expect(sdkLoaded).toHaveBeenCalledOnce();
    expect(initSentry).toHaveBeenCalledOnce();
    expect(initSentry).toHaveBeenCalledWith("server");
    expect(wrapFetchWithSentry).toHaveBeenCalledOnce();
    expect(requestServer).toHaveBeenCalledOnce();
    expect(functionServer).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("has no static (value) import of the SDK on the server path", async () => {
    // Nitro inlines dynamic imports into one server bundle, so a static
    // import in any of these files would evaluate the SDK at cold start.
    const { readFileSync } = await import("node:fs");
    for (const file of ["./server.ts", "./start.ts", "./instrument.server.ts", "./lib/sentry.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']@sentry\//m);
    }
  });
});
