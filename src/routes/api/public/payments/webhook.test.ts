/**
 * Tests for the two decisions in the payments webhook whose failure mode is
 * silence.
 *
 * `ownershipOf` / `handleCheckoutCompleted`: this endpoint sits on a Stripe
 * account shared with booked.co, petsupplies.co and PasskeyBridge, and Stripe
 * delivers every `checkout.session.completed` on the account to it. Until
 * 2026-09-15 the handler issued a satus license for any subscription
 * checkout, whoever's it was. Nothing failed; the wrong customer got a key.
 *
 * `subscriptionIdFromCharge`: the charge → subscription lookup that
 * `charge.refunded` uses to decide which license to revoke. When it returns
 * null the handler logs "no subscription" and returns 200; Stripe sees a
 * success, nothing retries, and a refunded customer keeps working access.
 * `Charge.invoice` existed before API version 2025-03-31.basil and was
 * removed by it, and this endpoint is registered with `api_version: null`,
 * so which shape arrives is decided by an account-level Dashboard setting.
 *
 * Nothing talks to Stripe, Supabase or the email route. Every client is a
 * stub that records its calls into one list, so a test can assert not only
 * what happened but what did not.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stripe.server")>();
  return { ...actual, createStripeClient: () => stripeStub };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: dbStub }));
vi.mock("@/lib/webhook-alerts.server", () => ({ notifyWebhookFailure: () => {} }));

type StubCall = { op: string; arg: unknown };

const calls: StubCall[] = [];
let invoicePaymentsResult: Array<{ invoice: unknown }> = [];
let invoiceRetrieveResult: unknown = null;
let subscriptionRetrieveResult: unknown = null;

const stripeStub = {
  invoices: {
    retrieve: (id: string) => {
      calls.push({ op: "invoices.retrieve", arg: id });
      return Promise.resolve(invoiceRetrieveResult);
    },
  },
  invoicePayments: {
    list: (params: unknown) => {
      calls.push({ op: "invoicePayments.list", arg: params });
      return Promise.resolve({ data: invoicePaymentsResult });
    },
  },
  subscriptions: {
    retrieve: (id: string, params?: unknown) => {
      calls.push({ op: "subscriptions.retrieve", arg: { id, params } });
      return Promise.resolve(subscriptionRetrieveResult);
    },
  },
};

/** Records every table touched and every upsert. Reads find no row. */
const dbStub = {
  from: (table: string) => {
    calls.push({ op: "db.from", arg: table });
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: null }),
      upsert: (row: unknown) => {
        calls.push({ op: "db.upsert", arg: row });
        return Promise.resolve({ error: null });
      },
    };
    return chain;
  },
};

const { handleCheckoutCompleted, ownershipOf, subscriptionIdFromCharge, Route } =
  await import("./webhook");

const realFetch = globalThis.fetch;

beforeEach(() => {
  calls.length = 0;
  invoicePaymentsResult = [];
  invoiceRetrieveResult = null;
  subscriptionRetrieveResult = null;
  // The email route is reached through fetch; record and succeed.
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ op: "fetch", arg: { url: String(url), body: init?.body } });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const ops = () => calls.map((c) => c.op);

// ---------------------------------------------------------------------------
// Fixtures: the three products that actually share the account, shaped the
// way their live objects are shaped (checked 2026-09-15).
// ---------------------------------------------------------------------------

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_fixture",
    mode: "subscription",
    subscription: "sub_fixture",
    customer: "cus_fixture",
    customer_details: { email: "Buyer@Example.com" },
    metadata: {},
    ...overrides,
  } as never;
}

function subscription(item: Record<string, unknown>, metadata: Record<string, string> = {}) {
  return {
    id: "sub_fixture",
    status: "active",
    cancel_at_period_end: false,
    metadata,
    items: { data: [{ current_period_end: 1791843182, price: item }] },
  } as never;
}

/** booked.co: `booked_` lookup key, `app` metadata, Lovable-managed price. */
const bookedPrice = {
  id: "price_booked",
  lookup_key: "booked_pro_monthly",
  product: { id: "prod_booked", name: "Booked Pro" },
};
const bookedMetadata = { app: "booked", plan: "pro" };

/** PasskeyBridge: no lookup key, no metadata, product simply named "Pro". */
const passkeyBridgePrice = {
  id: "price_pkb",
  lookup_key: null,
  product: { id: "prod_pkb", name: "Pro" },
};

/** satus: `satus_` lookup key; our checkout also stamps `source`. */
const satusPrice = {
  id: "price_satus",
  lookup_key: "satus_pro_monthly",
  product: { id: "prod_satus", name: "satus.sh — Pro" },
};
const satusMetadata = { source: "satus.sh", price_id: "satus_pro_monthly" };

describe("ownershipOf", () => {
  it("trusts the session metadata our checkout stamps", () => {
    expect(ownershipOf({ metadata: satusMetadata }, subscription(passkeyBridgePrice))).toEqual({
      ours: true,
      via: "session.metadata",
    });
  });

  it("trusts the subscription metadata our checkout stamps", () => {
    expect(ownershipOf({ metadata: {} }, subscription(passkeyBridgePrice, satusMetadata))).toEqual({
      ours: true,
      via: "subscription.metadata",
    });
  });

  it("accepts a satus_ lookup key with no metadata at all (a Dashboard sale)", () => {
    expect(ownershipOf({ metadata: {} }, subscription(satusPrice))).toEqual({
      ours: true,
      via: "lookup_key",
    });
  });

  it("rejects booked.co", () => {
    expect(ownershipOf({ metadata: {} }, subscription(bookedPrice, bookedMetadata))).toEqual({
      ours: false,
      product: "Booked Pro",
      namedSatus: false,
    });
  });

  it("rejects PasskeyBridge, which has neither a lookup key nor metadata", () => {
    expect(ownershipOf({ metadata: {} }, subscription(passkeyBridgePrice))).toEqual({
      ours: false,
      product: "Pro",
      namedSatus: false,
    });
  });

  it("trips the wire for a satus-named product that carries no marker", () => {
    const unmarked = { ...satusPrice, lookup_key: null };
    expect(ownershipOf({ metadata: {} }, subscription(unmarked))).toEqual({
      ours: false,
      product: "satus.sh — Pro",
      namedSatus: true,
    });
  });

  it("never trips the wire on an unexpanded product id", () => {
    const unexpanded = { id: "price_x", lookup_key: null, product: "prod_satus_lookalike" };
    expect(ownershipOf({ metadata: {} }, subscription(unexpanded))).toMatchObject({
      ours: false,
      namedSatus: false,
    });
  });
});

describe("handleCheckoutCompleted", () => {
  // The regression this block exists for.
  it("issues nothing for another product's checkout", async () => {
    subscriptionRetrieveResult = subscription(bookedPrice, bookedMetadata);

    await handleCheckoutCompleted(session(), "live");

    expect(ops()).toEqual(["subscriptions.retrieve"]);
    expect(calls[0].arg).toEqual({
      id: "sub_fixture",
      params: { expand: ["items.data.price.product"] },
    });
  });

  it("still issues a satus license, and emails the key", async () => {
    subscriptionRetrieveResult = subscription(satusPrice, satusMetadata);

    await handleCheckoutCompleted(session({ metadata: satusMetadata }), "live");

    expect(ops()).toEqual(["subscriptions.retrieve", "db.from", "db.from", "db.upsert", "fetch"]);
    const upsert = calls.find((c) => c.op === "db.upsert")!.arg as Record<string, unknown>;
    expect(upsert).toMatchObject({
      email: "buyer@example.com",
      stripe_subscription_id: "sub_fixture",
      plan: "satus_pro_monthly",
      status: "active",
      environment: "live",
      revoked_at: null,
    });
    expect(String(upsert.license_key)).toMatch(/^satus_live_[0-9a-f]{32}$/);
    const mail = calls.find((c) => c.op === "fetch")!.arg as { body: string };
    expect(JSON.parse(mail.body)).toMatchObject({
      templateName: "license-delivery",
      recipientEmail: "Buyer@Example.com",
    });
  });

  it("refuses to guess about a satus-named product with no marker", async () => {
    subscriptionRetrieveResult = subscription({ ...satusPrice, lookup_key: null });

    await expect(handleCheckoutCompleted(session(), "live")).rejects.toThrow(/named satus/);

    expect(ops()).toEqual(["subscriptions.retrieve"]);
  });

  it("does not touch Stripe for a one-time payment", async () => {
    await handleCheckoutCompleted(session({ mode: "payment" }), "live");

    expect(calls).toEqual([]);
  });
});

describe("subscriptionIdFromCharge", () => {
  /** A basil-era invoice: no top-level `subscription`, details under `parent`. */
  function modernInvoice(subscriptionId: string) {
    return { parent: { subscription_details: { subscription: subscriptionId } } };
  }

  it("reads the pre-basil Charge.invoice string", async () => {
    invoiceRetrieveResult = modernInvoice("sub_pre");

    const id = await subscriptionIdFromCharge({ invoice: "in_pre" } as never, "live");

    expect(id).toBe("sub_pre");
    expect(calls).toEqual([{ op: "invoices.retrieve", arg: "in_pre" }]);
  });

  it("reads a pre-basil expanded Charge.invoice object without a round trip", async () => {
    const id = await subscriptionIdFromCharge(
      { invoice: { subscription: "sub_expanded" } } as never,
      "live",
    );

    expect(id).toBe("sub_expanded");
    expect(calls).toEqual([]);
  });

  // Before the invoice_payments fallback this returned null and the refund
  // revoked nothing.
  it("resolves a basil payload through invoice_payments", async () => {
    invoicePaymentsResult = [{ invoice: "in_basil" }];
    invoiceRetrieveResult = modernInvoice("sub_basil");

    const id = await subscriptionIdFromCharge({ payment_intent: "pi_basil" } as never, "live");

    expect(id).toBe("sub_basil");
    expect(calls[0]).toEqual({
      op: "invoicePayments.list",
      arg: { payment: { type: "payment_intent", payment_intent: "pi_basil" }, limit: 1 },
    });
  });

  it("unwraps an expanded payment intent before filtering", async () => {
    invoicePaymentsResult = [{ invoice: "in_x" }];
    invoiceRetrieveResult = modernInvoice("sub_x");

    await subscriptionIdFromCharge({ payment_intent: { id: "pi_object" } } as never, "live");

    expect(calls[0].arg).toMatchObject({ payment: { payment_intent: "pi_object" } });
  });

  it("returns null for a one-time charge with neither link", async () => {
    expect(await subscriptionIdFromCharge({ id: "ch_1" } as never, "live")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("returns null when the payment intent belongs to no invoice", async () => {
    invoicePaymentsResult = [];

    expect(
      await subscriptionIdFromCharge({ payment_intent: "pi_none" } as never, "live"),
    ).toBeNull();
  });

  it("treats a deleted invoice as untraceable rather than reading absent fields", async () => {
    invoicePaymentsResult = [{ invoice: { deleted: true, id: "in_gone" } }];

    expect(
      await subscriptionIdFromCharge({ payment_intent: "pi_del" } as never, "live"),
    ).toBeNull();
    expect(ops()).toEqual(["invoicePayments.list"]);
  });

  it("prefers Charge.invoice when a payload somehow carries both", async () => {
    invoiceRetrieveResult = modernInvoice("sub_from_invoice");

    const id = await subscriptionIdFromCharge(
      { invoice: "in_both", payment_intent: "pi_both" } as never,
      "live",
    );

    expect(id).toBe("sub_from_invoice");
    expect(ops()).not.toContain("invoicePayments.list");
  });
});

type PostHandler = (ctx: { request: Request }) => Promise<Response>;

function postHandler(): PostHandler {
  const h = (Route as unknown as { options?: { server?: { handlers?: { POST?: PostHandler } } } })
    .options?.server?.handlers?.POST;
  if (!h) throw new Error("payments webhook POST handler is not registered");
  return h;
}

const WEBHOOK_URL = "https://satus.sh/api/public/payments/webhook";
const FIXTURE_WEBHOOK_SECRET = "whsec_test_fixture_not_a_real_secret";

function unsignedRequest(): Request {
  return new Request(WEBHOOK_URL, { method: "POST" });
}

function mismatchedSignatureRequest(): Request {
  const ts = Math.floor(Date.now() / 1000);
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers: { "stripe-signature": `t=${ts},v1=${"ab".repeat(32)}` },
    body: JSON.stringify({
      id: "evt_fixture",
      object: "event",
      type: "checkout.session.completed",
      livemode: true,
      data: { object: { id: "cs_fixture" } },
    }),
  });
}

describe("signature failure log level", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs a request with no signature at warn and returns a generic 400", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await postHandler()({ request: unsignedRequest() });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid signature");
    expect(warnSpy).toHaveBeenCalledWith("[payments-webhook] unsigned request");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs a signature mismatch at error and does not include the signing secret", async () => {
    vi.stubEnv("PAYMENTS_LIVE_WEBHOOK_SECRET", FIXTURE_WEBHOOK_SECRET);
    vi.stubEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET", FIXTURE_WEBHOOK_SECRET);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await postHandler()({ request: mismatchedSignatureRequest() });
    const logged = errorSpy.mock.calls
      .map((args) =>
        args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "),
      )
      .join("\n");

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid signature");
    expect(logged).toContain("[payments-webhook] signature verification failed");
    expect(logged).toContain("Invalid webhook signature");
    expect(logged).not.toContain(FIXTURE_WEBHOOK_SECRET);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
