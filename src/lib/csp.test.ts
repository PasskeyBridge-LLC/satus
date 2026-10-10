/**
 * The site ships a report-only Content-Security-Policy. An enforcing
 * `Content-Security-Policy` header is not set: the policy is observed,
 * not applied.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Header = { key: string; value: string };
type VercelConfig = { headers: Array<{ source: string; headers: Header[] }> };

const config = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
) as VercelConfig;

const siteHeaders = config.headers.find((block) => block.source === "/(.*)")?.headers ?? [];

function byKey(key: string): Header | undefined {
  return siteHeaders.find((header) => header.key === key);
}

describe("report-only content security policy", () => {
  it("sets Content-Security-Policy-Report-Only and does not enforce CSP", () => {
    const reportOnly = byKey("Content-Security-Policy-Report-Only");
    expect(reportOnly?.value).toBeTruthy();
    expect(byKey("Content-Security-Policy")).toBeUndefined();
    const value = reportOnly?.value ?? "";
    expect(value).toContain("default-src 'self'");
    expect(value).toContain("object-src 'none'");
    expect(value).toContain("https://analytics.ahrefs.com");
    expect(value).toContain("https://js.stripe.com");
    expect(value).toContain("https://fonts.gstatic.com");
    expect(value).toContain("https://*.ingest.us.sentry.io");
    expect(value).toMatch(/connect-src[^;]*https:\/\/\*\.ingest\.us\.sentry\.io/);
    expect(value).not.toMatch(/report-only/i);
  });
});
