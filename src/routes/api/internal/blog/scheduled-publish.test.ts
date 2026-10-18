import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:blog-schedule", () => ({
  builtAt: Date.parse("2026-10-22T22:00:00Z"),
  pending: [Date.parse("2026-10-23T13:00:00Z")],
}));

const { Route } = await import("./scheduled-publish");

type RouteHandler = (ctx: {
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;

function get(): RouteHandler {
  const h = (Route as unknown as { options?: { server?: { handlers?: { GET?: RouteHandler } } } })
    .options?.server?.handlers?.GET;
  if (!h) throw new Error("scheduled-publish GET handler is not registered");
  return h;
}

const call = (path: string, auth?: string) =>
  get()({
    request: new Request(`http://localhost${path}`, {
      headers: auth ? { Authorization: auth } : {},
    }),
    params: {},
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("scheduled-publish endpoint", () => {
  it("rejects missing and wrong credentials", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    expect((await call("/api/internal/blog/scheduled-publish")).status).toBe(401);
    expect((await call("/api/internal/blog/scheduled-publish", "Bearer nope")).status).toBe(403);
  });

  it("dry run at 2026-10-23T13:00Z reports a fire without calling the hook", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    vi.stubEnv("SCHEDULED_PUBLISH_DEPLOY_HOOK", "https://hook.invalid/x");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await call(
      "/api/internal/blog/scheduled-publish?dryRun=1&at=2026-10-23T13:00:30Z",
      "Bearer test-cron-secret",
    );
    const body = await res.json();
    expect(body).toMatchObject({
      due: ["2026-10-23T13:00:00.000Z"],
      fire: true,
      triggered: false,
      dryRun: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fires the hook when due, and never echoes the hook URL", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    vi.stubEnv("SCHEDULED_PUBLISH_DEPLOY_HOOK", "https://hook.invalid/secret-path");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T13:00:02Z"));
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await call("/api/internal/blog/scheduled-publish", "Bearer test-cron-secret");
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ triggered: true, hookStatus: 201 });
    expect(text).not.toContain("secret-path");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats SCHEDULED_PUBLISH_TEST_AT like a publishAt", async () => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    vi.stubEnv("SCHEDULED_PUBLISH_TEST_AT", "2026-10-23T01:00:00Z");
    const res = await call(
      "/api/internal/blog/scheduled-publish?dryRun=1&at=2026-10-23T01:00:10Z",
      "Bearer test-cron-secret",
    );
    expect(await res.json()).toMatchObject({ due: ["2026-10-23T01:00:00.000Z"], fire: true });
  });
});
