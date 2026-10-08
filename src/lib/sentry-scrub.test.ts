import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubSentryEvent } from "./sentry-scrub";

describe("sentry scrubber", () => {
  it("strips auth headers, cookies, request body, user, and query strings", () => {
    const event = scrubSentryEvent({
      user: { email: "buyer@example.com", ip_address: "203.0.113.9" },
      request: {
        url: "https://satus.sh/api/public/cli/run?key=satus_live_abc#frag",
        data: { license: "satus_live_abc" },
        body: '{"key":"secret"}',
        cookies: { session: "abc" },
        query_string: "key=satus_live_abc",
        headers: {
          Authorization: "Bearer cron-or-service-role",
          "stripe-signature": "t=1,v1=abc",
          Cookie: "session=abc",
          "X-Api-Key": "k",
          "Content-Type": "application/json",
        },
      },
      extra: {
        password: "hunter2",
        nested: { api_key: "sk_live_x", note: "ok" },
      },
      tags: { email: "buyer@example.com", plan: "pro" },
      message: "failed for buyer@example.com token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb",
      exception: {
        values: [
          {
            value:
              "stripe webhook for buyer@example.com eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb",
          },
        ],
      },
    });

    expect(event.user).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.body).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.url).toBe("https://satus.sh/api/public/cli/run");
    expect(event.request?.headers).toEqual({ "Content-Type": "application/json" });
    expect(event.extra).toEqual({
      password: "[redacted]",
      nested: { api_key: "[redacted]", note: "ok" },
    });
    expect(event.tags).toEqual({ email: "[redacted]", plan: "pro" });
    expect(event.message).toContain("[redacted]");
    expect(event.message).not.toContain("buyer@example.com");
    expect(event.exception?.values?.[0]?.value).not.toMatch(/@/);
    expect(event.exception?.values?.[0]?.value).not.toMatch(/eyJ/);
  });

  it("drops console breadcrumbs and strips URLs on the rest", () => {
    expect(scrubBreadcrumb({ category: "console", message: "secret dump" })).toBeNull();
    const nav = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/pricing?utm=1", to: "/checkout?session=abc#x" },
    });
    expect(nav?.data).toEqual({ from: "/pricing", to: "/checkout" });
  });
});
