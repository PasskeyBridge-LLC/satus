/**
 * The server SDK must not load at all when SENTRY_DSN is empty: no import
 * of @sentry/tanstackstart-react, no init, and the fetch wrapper and global
 * middlewares only call through. With a DSN it is error monitoring only:
 * no wrapFetchWithSentry (spans), exceptions captured and rethrown, and
 * queued events flushed at the end of a request.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const sdkLoaded = vi.fn();
const initSentry = vi.fn();
const captureException = vi.fn();
const flush = vi.fn(async () => true);
const wrapFetchWithSentry = vi.fn();
const httpIntegration = vi.fn((options: unknown) => ({ name: "Http", options }));

vi.mock("@sentry/tanstackstart-react", () => {
  sdkLoaded();
  return { captureException, flush, wrapFetchWithSentry, httpIntegration };
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

    const next = vi.fn(async () => "next-result");
    expect(await runSentryMiddleware("request", { next })).toBe("next-result");
    expect(await runSentryMiddleware("function", { next })).toBe("next-result");
    expect(next).toHaveBeenCalledTimes(2);

    const boom = new Error("boom");
    await expect(
      runSentryMiddleware("request", {
        next: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);

    expect(sdkLoaded).not.toHaveBeenCalled();
    expect(initSentry).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it("with SENTRY_DSN: inits once, flushes per request, never wraps fetch in spans", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.us.sentry.io/1");
    const { withServerSentry } = await import("./instrument.server");

    const fetch = withServerSentry(handler);
    expect(await (await fetch(request, {}, {})).text()).toBe("ok");
    await fetch(request, {}, {});

    expect(sdkLoaded).toHaveBeenCalledOnce();
    expect(initSentry).toHaveBeenCalledOnce();
    expect(httpIntegration).toHaveBeenCalledWith({ sessions: false, spans: false });
    expect(initSentry).toHaveBeenCalledWith("server", [
      { name: "Http", options: { sessions: false, spans: false } },
    ]);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(wrapFetchWithSentry).not.toHaveBeenCalled();
  });

  it("with SENTRY_DSN: middlewares pass results through and capture-and-rethrow errors", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@example.ingest.us.sentry.io/1");
    const { runSentryMiddleware } = await import("./instrument.server");

    expect(await runSentryMiddleware("request", { next: async () => "ok" })).toBe("ok");
    expect(captureException).not.toHaveBeenCalled();

    for (const kind of ["request", "function"] as const) {
      const boom = new Error(`boom-${kind}`);
      await expect(
        runSentryMiddleware(kind, {
          next: async () => {
            throw boom;
          },
        }),
      ).rejects.toBe(boom);
      expect(captureException).toHaveBeenLastCalledWith(boom, {
        mechanism: {
          type: expect.stringContaining(kind === "request" ? "request" : "server_function"),
          handled: false,
        },
      });
    }
    expect(captureException).toHaveBeenCalledTimes(2);
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

  it("uses no tracing APIs anywhere in the app source", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "./server.ts",
      "./start.ts",
      "./router.tsx",
      "./client.tsx",
      "./instrument.server.ts",
      "./lib/sentry.ts",
    ]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).not.toMatch(
        /wrapFetchWithSentry\(|BrowserTracingIntegration\(|browserTracingIntegration\(|tracesSampleRate:|tracesSampler:|replayIntegration|feedbackIntegration/,
      );
    }
  });
});
