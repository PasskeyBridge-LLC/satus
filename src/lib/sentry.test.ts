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
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      environment: "production",
    });
  });
});

describe("trace propagation targets", () => {
  it("matches satus.sh, its subdomains and same-origin paths", async () => {
    const { matchesSatusTraceTarget } = await import("./sentry");
    for (const url of [
      "https://satus.sh",
      "https://satus.sh/",
      "https://www.satus.sh/api/x?y=1",
      "https://satus.sh:443/pricing",
      "https://satus.sh#top",
      "/api/x",
    ]) {
      expect(matchesSatusTraceTarget(url), url).toBe(true);
    }
  });

  it("does not match look-alike or third-party hosts", async () => {
    const { matchesSatusTraceTarget } = await import("./sentry");
    for (const url of [
      "https://satus.sh.evil.test/",
      "https://evilsatus.sh/",
      "https://satus.shop/",
      "https://api.stripe.com/v1",
    ]) {
      expect(matchesSatusTraceTarget(url), url).toBe(false);
    }
  });
});
