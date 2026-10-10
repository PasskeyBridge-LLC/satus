/**
 * past_due inside the paid period is valid grace. The file header used to
 * say those keys are rejected. The header has to match the handler, and
 * the handler's answers stay put.
 */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type LicenseRow = {
  plan: string;
  status: string;
  current_period_end: string | null;
  revoked_at: string | null;
};

const { row } = vi.hoisted(() => ({
  row: { current: null as LicenseRow | null },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: () => Promise.resolve({ data: 1, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row.current, error: null }),
        }),
      }),
    }),
  },
}));

const { Route } = await import("./verify");

type PostHandler = (ctx: { request: Request }) => Promise<Response>;

function postHandler(): PostHandler {
  const handlers = (
    Route as unknown as {
      options?: { server?: { handlers?: { POST?: PostHandler } } };
    }
  ).options?.server?.handlers;
  if (!handlers?.POST) throw new Error("verify POST handler is not registered");
  return handlers.POST;
}

const KEY = "satus_test_" + "ab".repeat(16);

function post(key = KEY) {
  return postHandler()({
    request: new Request("http://localhost/api/public/license/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    }),
  });
}

const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  row.current = null;
});

describe("verify header", () => {
  it("says past_due within the period is valid grace", () => {
    const src = readFileSync(new URL("./verify.ts", import.meta.url), "utf8");
    const header = src.slice(0, src.indexOf("import "));
    expect(header).not.toMatch(/past-due keys are rejected/i);
    expect(header).toMatch(/past_due/);
    expect(header).toMatch(/within the current period/i);
    expect(header).toMatch(/revoked/i);
  });
});

describe("verify grace behaviour", () => {
  it("accepts past_due while the period has not ended", async () => {
    row.current = {
      plan: "satus_pro_monthly",
      status: "past_due",
      current_period_end: future(),
      revoked_at: null,
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ valid: true, plan: "pro" });
  });

  it("expires past_due once the period end is in the past", async () => {
    row.current = {
      plan: "satus_pro_monthly",
      status: "past_due",
      current_period_end: past(),
      revoked_at: null,
    };
    const res = await post();
    expect(await res.json()).toMatchObject({ valid: false, reason: "expired" });
  });

  it("rejects a revoked key", async () => {
    row.current = {
      plan: "satus_pro_monthly",
      status: "active",
      current_period_end: future(),
      revoked_at: past(),
    };
    const res = await post();
    expect(await res.json()).toMatchObject({ valid: false, reason: "revoked" });
  });

  it("accepts canceled while the paid period remains", async () => {
    row.current = {
      plan: "satus_pro_yearly",
      status: "canceled",
      current_period_end: future(),
      revoked_at: null,
    };
    const res = await post();
    expect(await res.json()).toMatchObject({ valid: true, plan: "pro" });
  });

  it("expires canceled after the period end", async () => {
    row.current = {
      plan: "satus_pro_yearly",
      status: "canceled",
      current_period_end: past(),
      revoked_at: null,
    };
    const res = await post();
    expect(await res.json()).toMatchObject({ valid: false, reason: "expired" });
  });
});
