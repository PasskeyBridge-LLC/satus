/**
 * What the real browser SDK (@sentry/react 11.4.0, which the client build
 * of @sentry/tanstackstart-react re-exports) sends with our client options,
 * captured by an in-memory transport instead of the network.
 *
 * Pins the error-monitoring-only standard: a clean page load sends nothing
 * (no session, no transaction, no client report), and an error sends exactly
 * one envelope holding one event, with no user, no IP, and
 * sdk.settings.infer_ip "never".
 *
 * Vitest runs in node here (no jsdom in this repo), so the test gives the
 * SDK the minimum of a browser it needs: a `document` and window-level
 * listeners. The control test at the end proves the harness can see a
 * page-load session envelope, so the zero above means something.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type Envelope = [Record<string, unknown>, Array<[Record<string, unknown>, unknown]>];

const page = new EventTarget();
const PAGE_URL = "https://satus.sh/pricing?ref=abc#plans";
const doc = Object.assign(new EventTarget(), {
  visibilityState: "visible" as string,
  location: { href: PAGE_URL },
  referrer: "https://search.example/?q=satus",
});

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.document = doc;
  g.location = { href: PAGE_URL };
  g.addEventListener = page.addEventListener.bind(page);
  g.removeEventListener = page.removeEventListener.bind(page);
});

/* Not a real DSN: a reserved .example host. */
const FAKE_DSN = "https://public@sentry.example/0";

async function sdk() {
  return await import("@sentry/react");
}

async function startWithCapture(overrides: Record<string, unknown> = {}): Promise<Envelope[]> {
  const { init } = await sdk();
  const { buildSentryInitOptions } = await import("./sentry");
  const sent: Envelope[] = [];
  init({
    ...buildSentryInitOptions("client"),
    dsn: FAKE_DSN,
    environment: "test",
    release: "abc123",
    ...overrides,
    transport: () => ({
      send: (envelope: unknown) => {
        sent.push(envelope as Envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
  } as Parameters<typeof init>[0]);
  return sent;
}

/** Everything a clean page load can trigger: idle callback, page hide, flush. */
async function finishPageLoad(): Promise<void> {
  const { flush } = await sdk();
  await new Promise((r) => setTimeout(r, 50));
  const hide = (state: string) => {
    doc.visibilityState = state;
    const event = new Event("visibilitychange");
    doc.dispatchEvent(event);
    page.dispatchEvent(new Event("visibilitychange"));
  };
  hide("hidden");
  await flush(500);
  hide("visible");
}

const itemTypes = (sent: Envelope[]) => sent.flatMap(([, items]) => items.map(([h]) => h.type));

afterEach(async () => {
  const { close, getCurrentScope, getIsolationScope } = await sdk();
  await close(500);
  getIsolationScope().setSession(undefined);
  getCurrentScope().setSession(undefined);
  getIsolationScope().setUser(null);
});

describe("browser Sentry envelopes with our options (real SDK, captured transport)", () => {
  it("our integration filter removes BrowserSession and never adds BrowserTracing", async () => {
    const { getDefaultIntegrations } = await sdk();
    const { buildSentryInitOptions } = await import("./sentry");
    const defaults = getDefaultIntegrations({});
    expect(defaults.map((i) => i.name)).toContain("BrowserSession");
    const names = buildSentryInitOptions("client")
      .integrations(defaults)
      .map((i) => i.name);
    expect(names).not.toContain("BrowserSession");
    expect(names).not.toContain("BrowserTracing");
    expect(names).toContain("GlobalHandlers");
  });

  it("a clean page load sends nothing: no session, no transaction, no client report", async () => {
    const sent = await startWithCapture();
    await finishPageLoad();
    expect(sent).toHaveLength(0);
  });

  it("an error sends exactly one envelope with one event, no user or IP, infer_ip never", async () => {
    const { captureException } = await sdk();
    const sent = await startWithCapture();
    captureException(new Error("boom for test"));
    await finishPageLoad();
    expect(sent).toHaveLength(1);
    expect(itemTypes(sent)).toEqual(["event"]);
    const event = sent[0]![1][0]![1] as Record<string, unknown> & {
      sdk?: { settings?: Record<string, unknown> };
    };
    expect(event).not.toHaveProperty("user");
    expect(JSON.stringify(event)).not.toMatch(/ip_address|\{\{auto\}\}/);
    expect(event.sdk?.settings?.infer_ip).toBe("never");
    // No headers (so no User-Agent or Referer) and no query string or fragment.
    const request = event.request as Record<string, unknown>;
    expect(request.url).toBe("https://satus.sh/pricing");
    expect(request.headers).toBeUndefined();
  });

  it("control: with SDK defaults (no dataCollection) the client asks Sentry to infer the IP", async () => {
    const { captureException } = await sdk();
    const sent = await startWithCapture({ dataCollection: undefined });
    captureException(new Error("control"));
    await finishPageLoad();
    const event = sent.flatMap(([, items]) => items).find(([h]) => h.type === "event")?.[1] as {
      sdk?: { settings?: Record<string, unknown> };
    };
    expect(event.sdk?.settings?.infer_ip).toBe("auto");
  });

  it("control: with the SDK's default integrations a clean page load sends a session", async () => {
    // Must stay last: setupOnce runs once per process, so a BrowserSession
    // installed here would never be re-installed for an earlier test.
    const sent = await startWithCapture({ integrations: undefined });
    await finishPageLoad();
    expect(itemTypes(sent)).toContain("session");
  });
});
