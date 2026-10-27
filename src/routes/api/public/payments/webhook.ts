/**
 * Stripe webhook handler—license fulfillment.
 *
 * Lives under /api/public/* because Stripe posts here unauthenticated.
 * Security is enforced in-handler via HMAC verification of the
 * `stripe-signature` header (verifyWebhook in stripe.server.ts). That
 * verification is also what tells us whether the event is sandbox or live:
 * the two environments have different endpoint secrets, so the one that
 * validates the body names the environment. `?env=` on the URL is only a
 * hint about which secret to try first.
 *
 * Events handled:
 *   - checkout.session.completed       → issue license, enqueue email
 *   - customer.subscription.updated    → sync status, period, cancel flag
 *   - customer.subscription.deleted    → revoke license
 *   - charge.refunded                  → revoke license tied to refunded
 *                                        charge's subscription (covers
 *                                        partial/standalone refunds that
 *                                        don't cancel the subscription)
 *
 * Idempotency: subscription rows key on `stripe_subscription_id` UNIQUE.
 * A repeated event upserts the same row, never duplicates. Refund
 * revocation is idempotent: repeat events rewrite the same status/
 * revoked_at and skip the email if already revoked.
 */

import type Stripe from "stripe";
import { createFileRoute } from "@tanstack/react-router";
import { createStripeClient, type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyWebhookFailure } from "@/lib/webhook-alerts.server";

/**
 * Two shapes, one handler.
 *
 * API version `2025-03-31.basil` moved `current_period_end` off the
 * subscription and onto each subscription item, moved `Invoice.subscription`
 * under `parent.subscription_details`, and dropped `Charge.invoice`
 * altogether (stripe-node 18.0.0 release notes). Our client is pinned to
 * `2026-03-25.dahlia`, so anything we *fetch* has the new shape—but a
 * webhook endpoint registered without an explicit `api_version` renders
 * events at the account's default version, so an older payload can still
 * arrive here.
 *
 * These aliases keep the legacy readings type-checked and labelled instead
 * of hiding them behind `any`, which is what they were doing before.
 */
type InvoicePayload = Stripe.Invoice & {
  /** Pre-basil location of `parent.subscription_details.subscription`. */
  subscription?: string | Stripe.Subscription | null;
};

type SubscriptionPayload = Stripe.Subscription & {
  /** Pre-basil location of the field now on `items.data[].current_period_end`. */
  current_period_end?: number | null;
};

type ChargePayload = Stripe.Charge & {
  /** Removed from `Charge` in basil; still present on pre-basil payloads. */
  invoice?: string | InvoicePayload | null;
};

const PLAN_LABELS: Record<string, string> = {
  satus_pro_monthly: "Pro · monthly",
  satus_pro_yearly: "Pro · yearly",
  satus_team_seat_monthly: "Team seat · monthly",
};

/** `satus_live_<32 hex>` for live, `satus_test_<32 hex>` for sandbox. */
function generateLicenseKey(env: StripeEnv): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const prefix = env === "live" ? "satus_live_" : "satus_test_";
  return prefix + hex;
}

function planLabel(plan: string | null | undefined): string {
  if (!plan) return "satus.sh subscription";
  return PLAN_LABELS[plan] ?? plan;
}

function isoDateOnly(ts: number | string | null | undefined): string | null {
  if (!ts) return null;
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return d.toISOString().slice(0, 10);
}

/** Deep link that opens a fresh Stripe Billing Portal session for this key. */
function manageUrl(licenseKey: string): string {
  return `https://satus.sh/api/public/billing/portal?key=${encodeURIComponent(licenseKey)}`;
}

/** Item first (basil and later), then the legacy top-level field. */
function periodEndOf(sub: SubscriptionPayload): number | null {
  return sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
}

/** Lookup key when the price has one, else the price id. */
function planOf(sub: Stripe.Subscription): string {
  const price = sub.items?.data?.[0]?.price;
  return price?.lookup_key ?? price?.id ?? "unknown";
}

/** What `payments.functions.ts` stamps on every session and subscription it creates. */
const SATUS_SOURCE = "satus.sh";
/** Every satus price in the catalog carries a lookup key with this prefix. */
const SATUS_LOOKUP_PREFIX = "satus_";

type Ownership =
  | { ours: true; via: "session.metadata" | "subscription.metadata" | "lookup_key" }
  | { ours: false; product: string; namedSatus: boolean };

/** The product's name when expanded; null for a bare id or a deleted product. */
function productNameOf(
  product: string | Stripe.Product | Stripe.DeletedProduct | null | undefined,
): string | null {
  if (!product || typeof product === "string") return null;
  if ("deleted" in product && product.deleted) return null;
  return product.name;
}

/**
 * Whether a completed checkout is a satus.sh sale.
 *
 * This endpoint is one of five on a Stripe account shared with booked.co,
 * petsupplies.co and PasskeyBridge, and Stripe delivers every
 * `checkout.session.completed` on the account to every endpoint subscribed
 * to it. Until 2026-09-15 nothing here asked whose sale it was: any
 * subscription checkout issued a satus license and emailed the key. A
 * booked.co subscription created on 2026-09-12 has a satus license row.
 *
 * Three markers, any one of which is enough. The first two are ours:
 * `payments.functions.ts` stamps `source: "satus.sh"` on the Checkout
 * Session and on the subscription it creates. The third is the catalog
 * convention — every satus price carries a `satus_` lookup key (checked
 * against the live account: satus_pro_monthly, satus_pro_yearly,
 * satus_team_seat_monthly, satus_live_smoke_test). booked.co's keys start
 * `booked_`; PasskeyBridge's prices have no lookup key at all.
 *
 * `namedSatus` is the tripwire for the failure that matters. A sale we skip
 * is a buyer with a receipt and no license, so when the product's *name*
 * says satus and none of the markers do, the caller throws rather than
 * quietly returning: 500, Stripe retries, ops gets the alert. That needs
 * `items.data.price.product` expanded on the subscription; unexpanded, the
 * tripwire is inert and the markers still decide.
 */
export function ownershipOf(
  session: Pick<Stripe.Checkout.Session, "metadata">,
  sub: Pick<Stripe.Subscription, "metadata" | "items">,
): Ownership {
  if (session.metadata?.source === SATUS_SOURCE) return { ours: true, via: "session.metadata" };
  if (sub.metadata?.source === SATUS_SOURCE) return { ours: true, via: "subscription.metadata" };

  const items = sub.items?.data ?? [];
  if (items.some((item) => item.price?.lookup_key?.startsWith(SATUS_LOOKUP_PREFIX))) {
    return { ours: true, via: "lookup_key" };
  }

  const names = items
    .map((item) => productNameOf(item.price?.product))
    .filter((name): name is string => name !== null);
  // For the log line: names when expanded, else whatever ids we have.
  const ids = items
    .map((item) =>
      typeof item.price?.product === "string" ? item.price.product : (item.price?.id ?? ""),
    )
    .filter(Boolean);
  const product = names.join(", ") || ids.join(", ") || "unknown";
  return { ours: false, product, namedSatus: /satus/i.test(names.join(" ")) };
}

/**
 * Enqueue a transactional email via the internal send route. Same auth
 * pattern as license-delivery: service-role bearer, idempotency keyed off
 * the subscription id + template so retries from Stripe never duplicate.
 */
async function enqueueTransactionalEmail(args: {
  templateName: string;
  recipientEmail: string;
  idempotencyKey: string;
  templateData: Record<string, unknown>;
}) {
  const origin = process.env.PUBLIC_SITE_URL ?? "https://satus.sh";
  const res = await fetch(`${origin}/api/internal/email/transactional/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      templateName: args.templateName,
      recipientEmail: args.recipientEmail,
      idempotencyKey: args.idempotencyKey,
      templateData: args.templateData,
    }),
  }).catch((err) => {
    console.error("[payments-webhook] email enqueue failed", args.templateName, err);
    return null;
  });
  if (res && !res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[payments-webhook] email enqueue non-2xx", args.templateName, res.status, body);
  }
}

export async function handleCheckoutCompleted(session: Stripe.Checkout.Session, env: StripeEnv) {
  if (session.mode !== "subscription") return;

  const subscriptionId: string | undefined =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? undefined);
  if (!subscriptionId) {
    throw new Error(`subscription-mode session ${session.id} has no subscription id`);
  }

  // Whose sale is this? Decided before the paid-customer contract below
  // applies, because another product's checkout is not our customer: it
  // gets a 200 and a log line — never a license, and never a 500 that would
  // page ops and put a booked.co sale on Stripe's three-day retry schedule.
  const stripe = createStripeClient(env);
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });
  const ownership = ownershipOf(session, sub);
  if (!ownership.ours) {
    if (ownership.namedSatus) {
      throw new Error(
        `session ${session.id}: product "${ownership.product}" is named satus but carries no satus marker (session.metadata.source, subscription.metadata.source, or a satus_ lookup key); refusing to guess`,
      );
    }
    console.log(
      `[payments-webhook] ${session.id} is another product on the shared account (${ownership.product}); no license issued`,
    );
    return;
  }

  // Past this point the customer has paid us. Every missing precondition and
  // failed write throws so the POST handler returns 500 (Stripe retries
  // for ~3 days) and ops gets the alert — a silent return here is a buyer
  // with a receipt and no license, and nobody would know.
  const email: string | undefined =
    session.customer_details?.email ?? session.customer_email ?? undefined;
  if (!email) {
    throw new Error(`no email on session ${session.id}; license cannot be delivered`);
  }

  const customerId: string | undefined =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) {
    throw new Error(`no customer id on session ${session.id}`);
  }

  const plan = planOf(sub);
  const periodEnd = periodEndOf(sub);

  const { data: existing } = await supabaseAdmin
    .from("licenses")
    .select("license_key")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  const licenseKey = existing?.license_key ?? generateLicenseKey(env);

  const { error } = await supabaseAdmin.from("licenses").upsert(
    {
      license_key: licenseKey,
      email: email.toLowerCase(),
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      plan,
      status: sub.status,
      environment: env,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      revoked_at: null,
    },
    { onConflict: "stripe_subscription_id" },
  );

  if (error) {
    // Idempotent on retry: the upsert keys on stripe_subscription_id and
    // the existing-key lookup above reuses an already-issued key.
    throw new Error(`license upsert failed: ${error.message}`);
  }

  await enqueueTransactionalEmail({
    templateName: "license-delivery",
    recipientEmail: email,
    idempotencyKey: `license-${subscriptionId}`,
    templateData: {
      licenseKey,
      planLabel: planLabel(plan),
      renewsOn: isoDateOnly(periodEnd),
      manageUrl: manageUrl(licenseKey),
    },
  });
}

async function handleSubscriptionUpdated(subscription: SubscriptionPayload, env: StripeEnv) {
  const plan = planOf(subscription);
  const periodEnd = periodEndOf(subscription);
  const cancelAtPeriodEnd = subscription.cancel_at_period_end ?? false;

  // Snapshot the existing row so we can detect the cancel_at_period_end
  // transition (false -> true) and send the cancellation email exactly
  // once. Stripe fires subscription.updated for many reasons (renewal,
  // plan change, payment method update)—without this guard we'd email
  // on every one.
  const { data: existing } = await supabaseAdmin
    .from("licenses")
    .select("email, cancel_at_period_end, license_key, revoked_at")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  /**
   * Un-revoke on reactivation.
   *
   * `revoked_at` is set by subscription.deleted and by charge.refunded, and
   * until now nothing ever cleared it except a brand-new checkout. That left
   * a trap: a subscription that is revoked and later becomes live again
   * without a new Checkout Session — a recovered `past_due`, a reactivation
   * from the billing portal, a refunded charge on a subscription that keeps
   * running — kept a license that `verify.ts` rejects. And it rejects it
   * *first*, before status or period, so the response is
   * `{ valid: false, reason: 'revoked' }` while Stripe bills the customer
   * every month. "Paid and locked out" is the worst failure this file has.
   *
   * Only `active` and `trialing` clear it. Deliberately not `past_due`:
   * that means a payment is currently failing, which is not the moment to
   * reverse a revocation. The 24-hour verdict cache means a customer sees
   * this within a day of Stripe reporting them live again.
   */
  const reactivated = subscription.status === "active" || subscription.status === "trialing";

  const { error: updateErr } = await supabaseAdmin
    .from("licenses")
    .update({
      status: subscription.status,
      plan,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: cancelAtPeriodEnd,
      ...(reactivated ? { revoked_at: null } : {}),
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);

  if (updateErr) {
    // Throw so the POST handler returns 500 and Stripe retries—silent
    // 200s here cause license state to drift from Stripe's source of truth.
    throw new Error(`license update failed: ${updateErr.message}`);
  }

  // Rare and worth seeing in the log when it happens: a license that was
  // rejecting every verify is now serving again.
  if (reactivated && existing?.revoked_at) {
    console.log(
      `[payments-webhook] un-revoked ${subscription.id} (${env}): status=${subscription.status}, was revoked ${existing.revoked_at}`,
    );
  }

  if (existing?.email && cancelAtPeriodEnd && !existing.cancel_at_period_end) {
    await enqueueTransactionalEmail({
      templateName: "subscription-canceled",
      recipientEmail: existing.email as string,
      idempotencyKey: `cancel-${subscription.id}`,
      templateData: {
        planLabel: planLabel(plan),
        accessEndsOn: isoDateOnly(periodEnd),
        manageUrl: existing.license_key ? manageUrl(existing.license_key as string) : undefined,
      },
    });
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, env: StripeEnv) {
  // Read email + plan + prior cancel_at_period_end BEFORE we mutate the row.
  // The prior flag tells us WHY this delete fired:
  //   - true  -> customer previously scheduled cancel; period now elapsed
  //              naturally -> "expired" copy.
  //   - false -> subscription was killed immediately (owner in dashboard,
  //              admin action, terminal dunning) -> "canceled" copy.
  // Sub.cancellation_details.reason exists in newer API versions but is
  // unreliable across historical events; the row we already own is the
  // single source of truth we trust.
  const { data: existing } = await supabaseAdmin
    .from("licenses")
    .select("email, plan, license_key, cancel_at_period_end")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  const nowIso = new Date().toISOString();

  const { error: revokeErr } = await supabaseAdmin
    .from("licenses")
    .update({
      status: "canceled",
      revoked_at: nowIso,
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);

  if (revokeErr) {
    throw new Error(`license revoke failed: ${revokeErr.message}`);
  }

  if (!existing?.email) return;

  const scheduledCancel = existing.cancel_at_period_end === true;
  const licenseKey = (existing.license_key as string | null) ?? null;

  if (scheduledCancel) {
    await enqueueTransactionalEmail({
      templateName: "subscription-expired",
      recipientEmail: existing.email as string,
      idempotencyKey: `expired-${subscription.id}`,
      templateData: {
        planLabel: planLabel(existing.plan as string | null),
        manageUrl: licenseKey ? manageUrl(licenseKey) : undefined,
      },
    });
  } else {
    // Immediate cancel: access ends today, not at a future period_end.
    await enqueueTransactionalEmail({
      templateName: "subscription-canceled",
      recipientEmail: existing.email as string,
      idempotencyKey: `cancel-immediate-${subscription.id}`,
      templateData: {
        planLabel: planLabel(existing.plan as string | null),
        accessEndsOn: nowIso.slice(0, 10),
        manageUrl: licenseKey ? manageUrl(licenseKey) : undefined,
      },
    });
  }
}

/**
 * Pull the subscription id out of an invoice, whichever shape it is in.
 * `parent.subscription_details` is where basil and later put it; the
 * top-level `subscription` is the pre-basil field. The retrieve path below
 * always yields the former, since our client is pinned to dahlia.
 */
function subscriptionIdFromInvoice(invoice: InvoicePayload): string | null {
  const sub = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : (sub.id ?? null);
}

/**
 * Resolve the subscription id behind a refunded charge. Stripe puts it on
 * the invoice, not the charge—so we follow charge → invoice → subscription.
 * Returns null for one-time charges or any shape we can't trace back.
 *
 * Two entry points, because there is no single one that spans both eras:
 *
 * - **Pre-basil:** `Charge.invoice`, read directly off the payload.
 * - **basil and later:** that field is gone from `Charge`, and nothing
 *   replaced it on the charge side. `PaymentIntent` has no `invoice` either.
 *   The edge runs the other way now—`InvoicePayment` carries the payment
 *   intent, and the list endpoint filters on it. So: charge →
 *   `payment_intent` → `invoice_payments` → invoice → subscription.
 *
 * Which one fires is not ours to choose. This endpoint is registered with
 * `api_version: null`, so Stripe renders its events at the *account's*
 * default version—a Dashboard setting that can change without touching this
 * repo. The `apiVersion` pin in `stripe.server.ts` governs the calls we make,
 * not the payloads we are handed. Handling both shapes is what makes that
 * setting stop mattering.
 *
 * Verified against the live account on 2026-09-15, not inferred: invoice
 * payment `inpay_1UEzAUGTWx4Bh4zbN5qX2q0j` resolves from payment intent
 * `pi_3UEzARGTWx4Bh4zb22KeO3zV` to invoice `in_1UEzAQGTWx4Bh4zbN9C7qD6R`,
 * whose `parent.subscription_details.subscription` is the subscription.
 */
export async function subscriptionIdFromCharge(
  charge: ChargePayload,
  env: StripeEnv,
): Promise<string | null> {
  const stripe = createStripeClient(env);

  const invoiceField = charge?.invoice;
  if (invoiceField) {
    if (typeof invoiceField === "object") {
      return subscriptionIdFromInvoice(invoiceField);
    }
    const invoice = await stripe.invoices.retrieve(invoiceField);
    return subscriptionIdFromInvoice(invoice);
  }

  const paymentIntentField = charge?.payment_intent;
  if (!paymentIntentField) return null;
  const paymentIntentId =
    typeof paymentIntentField === "string" ? paymentIntentField : paymentIntentField.id;

  const payments = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
    limit: 1,
  });

  const invoiceRef = payments.data[0]?.invoice;
  if (!invoiceRef) return null;

  // A deleted invoice carries no subscription details; treat it as untraceable
  // rather than reading fields that are not there.
  if (typeof invoiceRef === "object") {
    return "deleted" in invoiceRef ? null : subscriptionIdFromInvoice(invoiceRef);
  }
  const invoice = await stripe.invoices.retrieve(invoiceRef);
  return subscriptionIdFromInvoice(invoice);
}

async function handleChargeRefunded(charge: ChargePayload, env: StripeEnv) {
  const subscriptionId = await subscriptionIdFromCharge(charge, env);
  if (!subscriptionId) {
    // One-time charge or untraceable; nothing to revoke. Logged so we
    // notice if a real subscription refund ever lands here.
    console.log("[payments-webhook] charge.refunded with no subscription", charge.id);
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from("licenses")
    .select("email, plan, revoked_at")
    .eq("stripe_subscription_id", subscriptionId)
    .eq("environment", env)
    .maybeSingle();

  if (!existing) {
    console.log("[payments-webhook] charge.refunded: no license for", subscriptionId);
    return;
  }

  // Already revoked (e.g. earlier refund or subscription.deleted ran
  // first). Skip the write and email so retries stay quiet.
  if (existing.revoked_at) return;

  const { error } = await supabaseAdmin
    .from("licenses")
    .update({
      status: "refunded",
      revoked_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId)
    .eq("environment", env);

  if (error) {
    // Same contract as the other write failures: 500 for Stripe's retry
    // schedule plus the ops alert. Retries are safe — the revoked_at guard
    // above short-circuits once the write lands.
    throw new Error(`refund revoke failed: ${error.message}`);
  }

  if (existing.email) {
    await enqueueTransactionalEmail({
      templateName: "subscription-expired",
      recipientEmail: existing.email as string,
      idempotencyKey: `refunded-${subscriptionId}`,
      templateData: {
        planLabel: planLabel(existing.plan as string | null),
      },
    });
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // `?env=` is a hint, not a gate. It used to be required and checked
        // here, ahead of any authentication, which made a dashboard-managed
        // query string load-bearing for license issuance. An endpoint
        // registered without it got a 400, and Stripe does not retry 400s.
        // That dropped 21 days of live events in August 2026 and then did
        // the same to test mode in September. The signature decides the
        // environment now; see `verifyWebhook`.
        const rawEnv = new URL(request.url).searchParams.get("env");
        const hint: StripeEnv | null = rawEnv === "sandbox" || rawEnv === "live" ? rawEnv : null;

        let event: Stripe.Event;
        let env: StripeEnv;
        try {
          ({ event, env } = await verifyWebhook(request, hint));
        } catch (err) {
          // A request with no signature or no body is probe traffic. Log it
          // at warn. A request that has a signature and still fails
          // verification stays at error. Neither path sends an alert.
          if (err instanceof Error && err.message === "Missing signature or body") {
            console.warn("[payments-webhook] unsigned request");
          } else {
            console.error("[payments-webhook] signature verification failed", err);
          }
          return new Response("Invalid signature", { status: 400 });
        }

        // Past this line the body is signed, so everything below is Stripe.
        if (!hint) {
          // Resolved anyway. Worth seeing in the log so the endpoint URL
          // eventually gets tidied, but nothing is failing, so it does not
          // wake anyone.
          console.warn(
            `[payments-webhook] endpoint URL has no valid ?env= (got ${JSON.stringify(rawEnv)}); resolved ${env} from the signature`,
          );
        }

        // The secret that verified is the authority. `livemode` disagreeing
        // with it would mean Stripe signed a test event with the live
        // endpoint secret or vice versa, which should be impossible—log it
        // rather than act on it.
        if (event.livemode !== (env === "live")) {
          console.warn(
            `[payments-webhook] livemode/secret mismatch: livemode=${event.livemode} resolved=${env} event=${event.id}`,
          );
        }

        try {
          switch (event.type) {
            case "checkout.session.completed":
              await handleCheckoutCompleted(event.data.object, env);
              break;
            case "customer.subscription.updated":
              await handleSubscriptionUpdated(event.data.object, env);
              break;
            case "customer.subscription.deleted":
              await handleSubscriptionDeleted(event.data.object, env);
              break;
            case "charge.refunded":
              await handleChargeRefunded(event.data.object, env);
              break;
            default:
              break;
          }
          return Response.json({ received: true });
        } catch (err) {
          console.error("[payments-webhook] handler error", event.type, err);
          // Fire-and-await the alert so the DB dedup insert lands before
          // we return 500 and Stripe queues an immediate retry. notify…
          // never throws, so it can't bump us off the 500 path.
          await notifyWebhookFailure({
            eventId: event.id ?? null,
            eventType: event.type,
            environment: env,
            error: err,
          });
          // 500 keeps Stripe's retry schedule alive; a 200 here would
          // silently drop the event and the alert would be our only
          // record that it ever happened.
          return new Response("Handler error", { status: 500 });
        }
      },
    },
  },
});
