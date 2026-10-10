import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const sdkLoaded = vi.fn();

vi.mock("@sentry/tanstackstart-react", () => {
  sdkLoaded();
  return { init };
});

describe("sentry init", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    init.mockReset();
    sdkLoaded.mockReset();
    Reflect.deleteProperty(import.meta.env, "VITE_SENTRY_DSN");
  });

  it("is a no-op without a DSN on the server", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { initSentry } = await import("./sentry");
    expect(await initSentry("server")).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
    expect(sdkLoaded).not.toHaveBeenCalled();
  });

  it("is a no-op without a DSN on the client", async () => {
    const { initSentry } = await import("./sentry");
    expect(await initSentry("client")).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
    expect(sdkLoaded).not.toHaveBeenCalled();
  });

  it("calls Sentry.init when the server DSN is set", async () => {
    vi.stubEnv("SENTRY_DSN", "https://example.ingest.us.sentry.io/1");
    vi.stubEnv("VERCEL_ENV", "production");
    const { initSentry } = await import("./sentry");
    await initSentry("server");
    expect(init).toHaveBeenCalledOnce();
    expect(init.mock.calls[0]?.[0]).toMatchObject({
      dsn: "https://example.ingest.us.sentry.io/1",
      sendClientReports: false,
      tracePropagationTargets: [],
      dataCollection: { userInfo: false },
      environment: "production",
    });
  });
});

describe("error monitoring only", () => {
  it("propagates trace headers to no origin", async () => {
    const { SATUS_TRACE_PROPAGATION_TARGETS, sentrySharedOptions } = await import("./sentry");
    expect(SATUS_TRACE_PROPAGATION_TARGETS).toEqual([]);
    expect(sentrySharedOptions("server").tracePropagationTargets).toEqual([]);
    expect(sentrySharedOptions("client").tracePropagationTargets).toEqual([]);
  });

  it("sets no tracing, no client reports, and collects no personal data", async () => {
    const { sentrySharedOptions } = await import("./sentry");
    for (const runtime of ["client", "server"] as const) {
      const options = sentrySharedOptions(runtime) as Record<string, unknown>;
      expect(options).not.toHaveProperty("tracesSampleRate");
      expect(options).not.toHaveProperty("tracesSampler");
      expect(options).not.toHaveProperty("replaysSessionSampleRate");
      expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
      expect(options.sendClientReports).toBe(false);
      expect(options.traceLifecycle).toBe("static");
      // Removed in SDK 11; setting it would do nothing.
      expect(options).not.toHaveProperty("sendDefaultPii");
      expect(options.dataCollection).toEqual({
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
      });
    }
  });

  it("drops session and tracing integrations and keeps the error ones", async () => {
    const { errorOnlyIntegrations } = await import("./sentry");
    const named = (name: string) => ({ name });
    const extra = named("Http");
    const kept = errorOnlyIntegrations(
      [
        "InboundFilters",
        "GlobalHandlers",
        "LinkedErrors",
        "Dedupe",
        "BrowserSession",
        "BrowserTracing",
        "ProcessSession",
        "Http",
        "OnUncaughtException",
      ].map(named),
      [extra],
    ).map((i) => i.name);
    expect(kept).toEqual([
      "InboundFilters",
      "GlobalHandlers",
      "LinkedErrors",
      "Dedupe",
      "OnUncaughtException",
      "Http",
    ]);
  });

  it("passes the error-only integration filter to Sentry.init", async () => {
    vi.stubEnv("SENTRY_DSN", "https://example.ingest.us.sentry.io/1");
    const { initSentry } = await import("./sentry");
    await initSentry("server");
    const options = init.mock.calls[0]?.[0] as {
      integrations: (d: Array<{ name: string }>) => Array<{ name: string }>;
      tracesSampleRate?: number;
    };
    expect(options.tracesSampleRate).toBeUndefined();
    const names = options
      .integrations([{ name: "BrowserSession" }, { name: "ProcessSession" }, { name: "Dedupe" }])
      .map((i) => i.name);
    expect(names).toContain("Dedupe");
    expect(names).not.toContain("BrowserSession");
    expect(names).not.toContain("ProcessSession");
  });
});
