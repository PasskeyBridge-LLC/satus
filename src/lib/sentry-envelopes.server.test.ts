/**
 * What the real server SDK (@sentry/tanstackstart-react 11.4.0, node build)
 * sends with our server options, captured by an in-memory transport. A
 * quiet process sends nothing (no session, no transaction, no client
 * report); an error sends exactly one envelope with one event and no user,
 * IP, or request headers.
 */
import { afterAll, describe, expect, it } from "vitest";
import * as Sentry from "@sentry/tanstackstart-react";
import { buildSentryInitOptions } from "./sentry";

type Envelope = [Record<string, unknown>, Array<[Record<string, unknown>, unknown]>];

/* Not a real DSN: a reserved .example host. */
const FAKE_DSN = "https://public@sentry.example/0";
const sent: Envelope[] = [];

Sentry.init({
  ...buildSentryInitOptions("server", [Sentry.httpIntegration({ sessions: false, spans: false })]),
  dsn: FAKE_DSN,
  environment: "test",
  release: "abc123",
  transport: () => ({
    send: (envelope: unknown) => {
      sent.push(envelope as Envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  }),
} as Parameters<typeof Sentry.init>[0]);

afterAll(async () => {
  await Sentry.close(500);
});

const itemTypes = () => sent.flatMap(([, items]) => items.map(([h]) => h.type));

describe("server Sentry envelopes with our options (real SDK, captured transport)", () => {
  it("drops the session and tracing integrations", () => {
    const names = Object.keys(
      (Sentry.getClient() as unknown as { _integrations: Record<string, unknown> })._integrations,
    );
    expect(names).not.toContain("ProcessSession");
    expect(names).not.toContain("Console");
    expect(names).toContain("Http");
    expect(names).toContain("OnUncaughtException");
    expect(names).not.toContain("SpanStreaming");
  });

  it("sends nothing without an error", async () => {
    await Sentry.withIsolationScope(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await Sentry.flush(500);
    expect(sent).toHaveLength(0);
  });

  it("an error sends exactly one envelope with one event, no user, IP, or headers", async () => {
    Sentry.withIsolationScope((scope) => {
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          url: "https://satus.sh/pricing?ref=abc",
          method: "GET",
          headers: {
            "x-forwarded-for": "203.0.113.9",
            "user-agent": "Mozilla/5.0",
            cookie: "a=b",
          },
        },
        ipAddress: "203.0.113.9",
      });
      Sentry.captureException(new Error("server boom for test"));
    });
    await Sentry.flush(500);
    expect(sent).toHaveLength(1);
    expect(itemTypes()).toEqual(["event"]);
    const event = sent[0]![1][0]![1] as Record<string, unknown> & {
      request?: Record<string, unknown>;
    };
    expect(event).not.toHaveProperty("user");
    // Everything but the stack trace, whose context lines quote this file.
    const json = JSON.stringify({ ...event, exception: undefined });
    expect(json).not.toContain("203.0.113.9");
    expect(json).not.toMatch(/ip_address|\{\{auto\}\}|cookie/i);
    expect(event.request?.url).toBe("https://satus.sh/pricing");
    expect(event.request ?? {}).not.toHaveProperty("query_string");
  });
});
