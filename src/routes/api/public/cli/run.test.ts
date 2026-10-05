/**
 * POST /api/public/cli/run must refuse writes once a single IP hash has
 * used its hourly budget, and it must refuse when the counter itself
 * cannot answer. A public insert with no ceiling fills `satus_runs`.
 *
 * The handler is the route's POST function. Supabase is a stub, so the
 * test can see both the 429 and that no insert or upsert ran.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

type RpcResult = { data: number | null; error: { message: string } | null };

const { rpcResult, calls } = vi.hoisted(() => ({
  rpcResult: {
    current: { data: 1, error: null } as RpcResult,
  },
  calls: [] as { op: string; arg: unknown }[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: unknown) => {
      calls.push({ op: "rpc", arg: { fn, args } });
      return Promise.resolve(rpcResult.current);
    },
    from: (table: string) => {
      calls.push({ op: "from", arg: table });
      const chain = {
        upsert: (row: unknown) => {
          calls.push({ op: "upsert", arg: row });
          return Promise.resolve({ error: null });
        },
        insert: (row: unknown) => {
          calls.push({ op: "insert", arg: row });
          return chain;
        },
        select: () => chain,
        single: () =>
          Promise.resolve({
            data: { id: "00000000-0000-4000-8000-000000000001" },
            error: null,
          }),
      };
      return chain;
    },
  },
}));

const { Route } = await import("./run");

type PostHandler = (ctx: { request: Request }) => Promise<Response>;

function postHandler(): PostHandler {
  const handlers = (
    Route as unknown as {
      options?: { server?: { handlers?: { POST?: PostHandler } } };
    }
  ).options?.server?.handlers;
  if (!handlers?.POST) throw new Error("cli/run POST handler is not registered");
  return handlers.POST;
}

const VALID = {
  status: "success",
  cli_version: "0.3.11",
  environment: "dev",
  table_count: 1,
  total_rows: 1,
};

function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/public/cli/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  calls.length = 0;
  rpcResult.current = { data: 1, error: null };
});

describe("POST /api/public/cli/run rate limit", () => {
  it("returns 429 and does not write once the IP hash is over the hourly ceiling", async () => {
    rpcResult.current = { data: 61, error: null };
    const res = await postHandler()({
      request: request(VALID, { "x-forwarded-for": "203.0.113.50, 10.0.0.1" }),
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, reason: "rate_limited" });
    expect(calls.map((c) => c.op)).toEqual(["rpc"]);
    expect(calls[0]?.arg).toEqual({
      fn: "check_rate_limit",
      args: {
        p_bucket: "cli_run",
        p_key: hashIp("203.0.113.50"),
        p_window_seconds: 3600,
      },
    });
  });

  it("fails closed when the counter errors, and writes nothing", async () => {
    rpcResult.current = { data: null, error: { message: "counter down" } };
    const res = await postHandler()({
      request: request(VALID, { "cf-connecting-ip": "198.51.100.8" }),
    });
    expect(res.status).toBe(429);
    expect(calls.map((c) => c.op)).toEqual(["rpc"]);
  });

  it("fails closed when the counter returns a non-number", async () => {
    rpcResult.current = { data: null, error: null };
    const res = await postHandler()({
      request: request(VALID, { "x-forwarded-for": "198.51.100.9" }),
    });
    expect(res.status).toBe(429);
    expect(calls.some((c) => c.op === "from")).toBe(false);
  });

  it("writes when the counter is at the ceiling", async () => {
    rpcResult.current = { data: 60, error: null };
    const res = await postHandler()({
      request: request(VALID, { "x-forwarded-for": "198.51.100.10" }),
    });
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.op)).toEqual(["rpc", "from", "insert"]);
  });

  it("prefers cf-connecting-ip and hashes a missing address as unknown", async () => {
    rpcResult.current = { data: 61, error: null };
    await postHandler()({
      request: request(VALID, {
        "cf-connecting-ip": "192.0.2.4",
        "x-forwarded-for": "203.0.113.9",
      }),
    });
    expect(calls[0]?.arg).toMatchObject({
      args: { p_key: hashIp("192.0.2.4") },
    });

    calls.length = 0;
    await postHandler()({ request: request(VALID) });
    expect(calls[0]?.arg).toMatchObject({
      args: { p_key: hashIp("unknown") },
    });
  });

  it("does not spend the budget on a body that fails validation", async () => {
    const bad = await postHandler()({ request: request("not-json") });
    expect(bad.status).toBe(400);
    const invalid = await postHandler()({ request: request({ status: "nope" }) });
    expect(invalid.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("upserts by id only after the counter accepts the call", async () => {
    rpcResult.current = { data: 2, error: null };
    const id = "11111111-1111-4111-8111-111111111111";
    const res = await postHandler()({
      request: request({ ...VALID, id, status: "running" }, { "x-forwarded-for": "192.0.2.20" }),
    });
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.op)).toEqual(["rpc", "from", "upsert"]);
  });
});
