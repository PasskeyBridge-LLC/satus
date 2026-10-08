/**
 * Source maps must not ship in the deploy when SENTRY_AUTH_TOKEN is absent.
 * The Vite plugin is gated on that token for that reason.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

describe("sentry vite plugin gate", () => {
  it("only registers sentryTanstackStart when SENTRY_AUTH_TOKEN is set", () => {
    expect(src).toMatch(/sentryAuthToken/);
    expect(src).toMatch(/\.\.\.\(sentryAuthToken/);
    expect(src).toMatch(/filesToDeleteAfterUpload/);
    expect(src).toMatch(/org: "passkeybridge-llc"/);
    expect(src).toMatch(/project: "satus"/);
  });
});
