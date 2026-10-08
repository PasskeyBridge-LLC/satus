import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();

vi.mock("@sentry/tanstackstart-react", () => ({
  init,
}));

describe("sentry init", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    init.mockReset();
    Reflect.deleteProperty(import.meta.env, "VITE_SENTRY_DSN");
  });

  it("is a no-op without a DSN on the server", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { initSentry } = await import("./sentry");
    expect(initSentry("server")).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
  });

  it("is a no-op without a DSN on the client", async () => {
    const { initSentry } = await import("./sentry");
    expect(initSentry("client")).toBeUndefined();
    expect(init).not.toHaveBeenCalled();
  });

  it("calls Sentry.init when the server DSN is set", async () => {
    vi.stubEnv("SENTRY_DSN", "https://example.ingest.us.sentry.io/1");
    vi.stubEnv("VERCEL_ENV", "production");
    const { initSentry } = await import("./sentry");
    initSentry("server");
    expect(init).toHaveBeenCalledOnce();
    expect(init.mock.calls[0]?.[0]).toMatchObject({
      dsn: "https://example.ingest.us.sentry.io/1",
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      environment: "production",
    });
  });
});
