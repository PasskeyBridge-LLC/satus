---
slug: saas-subscriptions-profile
title: "Inside the saas-subscriptions profile: MRR, churn, and the dunning death spiral"
description: Subscription lifecycles, plan changes, failed payments, and the states no one documents. What the satus saas-subscriptions profile recommends, and what it leaves to you.
date: 2026-06-26
author: satus.sh
tags: [profile, saas, billing, postgres, seeding]
draft: false
---

> **Editor's note (2026-07-16):** This post describes profile-system design intent from mid-2026. The shipped CLI (v0.3.5) uses prompt-based profiles — `saas`, `ecommerce`, `b2b` — with no YAML profile files or per-profile invariant enforcement beyond the user's Postgres constraints. See [/profiles](/profiles) for the current behavior. The post is preserved for its subscription-lifecycle modeling arguments.



A SaaS billing schema looks like four tables and is, in practice, a small distributed system with a clock, a state machine, and a ledger. Subscriptions move through a fixed set of statuses on a fixed set of triggers. Invoices are arithmetic over a plan price and a usage stream, not free-form numbers. Failed payments are a retry schedule that ends in either recovery or cancellation, never in silence. A uniformly random fixture satisfies the schema and reproduces none of these dynamics, which is why dashboards built on uniform data look healthy until a real customer's card declines. The `saas-subscriptions` profile in [satus](/) is our spec for those dynamics: the rules we want the LLM to follow when it fills your rows, and the schema-side guard rails we recommend so the database catches what the model misses. This post is the inventory.

A note on what "the profile" is, today and on the roadmap. In v0.3 the profile is a single high-signal prompt block ([packages/cli/src/generate/profiles.ts](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/profiles.ts)) that steers the LLM toward the distributions, status mix, and language described below; satus then runs the offline validator on what comes back. The status-machine enforcement, the canonical MRR/churn views, the dunning sampler, and the Poisson usage generator described in this post are the profile's specification, not yet shipped modules. They are the next milestone for `saas-subscriptions` and the reason this post reads like a spec; treat it as the contract the v0.4 profile will honour and as a checklist you can apply today if you wire the recommended constraints into your own schema. Sections below say explicitly where the line sits.

The shape of this post mirrors the [medical-booking deep-dive](/blog/medical-booking-profile) and the [e-commerce deep-dive](/blog/ecommerce-profile): the distributions we steer toward, the constraints we lean on, and the things we deliberately decline to ship. It assumes you have read [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), because `orgs ↔ users` is the canonical small cycle and this profile is the one we built to exercise it, and [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), because subscription rows carry more state-flag timestamps than any other table in a typical SaaS schema.

## Why a uniform fixture is the wrong fixture

A uniform fixture for a SaaS schema gives every customer the same probability of churning this month, every invoice a value drawn from a flat distribution, and every subscription an equal probability of sitting in every status. None of those shapes exist in production. Real subscription bases concentrate cancellations in the first two billing cycles and again at annual-renewal anniversaries. Real invoice amounts cluster sharply around plan prices with a long right tail from usage. Real subscription rows are dominated by `active`, with `trialing` a small recent slice and `past_due` a smaller chronic slice that drains slowly into `canceled` or `active` again. A planner that has only seen flat statistics will pick the wrong index every time you query `WHERE status = 'past_due'`, and a dunning job tested against a fixture without `past_due` rows has never run its actual code path.

## The status machine, which is most of the value

The Stripe API documents eight subscription statuses on the canonical `Subscription` object: `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, and `paused` ([Stripe API: The Subscription object](https://docs.stripe.com/api/subscriptions/object)). Almost no internal SaaS schema we have read documents all eight. The profile encodes seven of them by default and treats `paused` as opt-in, because pause behaviour varies enough across products that a default would be wrong more often than right.

| Status | Meaning | Default share | Reachable from |
| --- | --- | --- | --- |
| `incomplete` | First invoice has not been paid within 23 hours of creation | 0.01 | (initial) |
| `incomplete_expired` | First invoice was never paid and the subscription was abandoned | 0.01 | `incomplete` |
| `trialing` | Inside a free-trial window, no payment attempted yet | 0.06 | (initial) |
| `active` | Latest invoice paid, in good standing | 0.78 | `trialing`, `past_due`, `incomplete` |
| `past_due` | Latest invoice failed, retries in flight | 0.05 | `active` |
| `unpaid` | Retries exhausted, access policy is product-specific | 0.02 | `past_due` |
| `canceled` | Terminal | 0.07 | any non-terminal |

The shares are a default that we know will be wrong for any specific product. They sit in the range that a generic mid-funnel SaaS in steady state could plausibly produce, and they are explicitly overridable. The point of shipping a default is not that 78% `active` is right for your company; it is that 12.5% per status (a flat uniform) is wrong for every company.

The legal transitions are the more important half. `canceled` is terminal; no production billing system flips a canceled row back to `active` without creating a new subscription row. `unpaid` is reachable only from `past_due`. `trialing` is reachable only as an initial state. Today the profile communicates these rules to the LLM in prose and the validator catches the gross violations (unknown statuses, type mismatches, FK breaks); the v0.4 state-machine module will enforce the full transition graph at plan time and reject any sampled history that violates it. Either way, the section below is the SQL we recommend so the database enforces the same rules independently of the seeder.

## Constraints we recommend (you write these, today)

The profile is more useful when the schema has the constraints below, because they catch the cases the LLM and the validator alone cannot. These are recommendations for your migrations; satus does not alter your schema.

```sql
-- 1. Status is a small closed set. Use an enum or a CHECK; both work.
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_known
  CHECK (status IN (
    'incomplete', 'incomplete_expired', 'trialing',
    'active', 'past_due', 'unpaid', 'canceled', 'paused'
  ));

-- 2. Exactly one owner per org. Partial unique index, not a trigger.
CREATE UNIQUE INDEX memberships_one_owner_per_org
  ON memberships (org_id)
  WHERE role = 'owner';

-- 3. Money is integer minor units. Cents, not numeric.
ALTER TABLE invoices
  ALTER COLUMN amount_cents TYPE bigint;

-- 4. Invoice total is derived; let the database compute it where possible.
ALTER TABLE invoices
  ADD COLUMN total_cents bigint
  GENERATED ALWAYS AS (subtotal_cents + tax_cents - discount_cents) STORED;

-- 5. A subscription cannot end before it starts.
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_period_ordered
  CHECK (current_period_end > current_period_start);
```

Two of these matter more than the others. The partial unique index on `memberships` is the canonical Postgres pattern for "at most one row in this set matches this predicate"; it is enforced by the index itself, with no trigger and no race window ([PostgreSQL documentation: Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)). The generated column on `invoices` is enforced by the database every write, which means the fixture and the application cannot disagree about the total ([PostgreSQL documentation: Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html), shipped since PostgreSQL 12). The other three are good hygiene; satus's validator will flag rows that violate any of them once you add them.

For status, an enum and a `CHECK` are both reasonable, with different ergonomics for adding a new value later. We covered the trade-off in [Enum types that grew up](/blog/enum-types-that-grew-up); the short version is that since PostgreSQL 12 `ALTER TYPE ... ADD VALUE` no longer requires a separate transaction, and the historical reason for preferring `CHECK` has largely been retired.

## MRR, which is a definition more than a measurement

Monthly recurring revenue is the sum of normalised subscription values that are currently in a recurring-billing state. The profile's recommended shape exposes it as a view, not a column, so it stays in sync with whatever the underlying rows say. The view below is the spec we propose for your schema (and the one the v0.4 reporting helpers will emit on request); copy it into a migration if you want it today:

```sql
CREATE VIEW mrr_components AS
SELECT
  s.id AS subscription_id,
  s.org_id,
  s.currency,
  CASE p.interval
    WHEN 'month'   THEN p.base_cents
    WHEN 'year'    THEN p.base_cents / 12
    WHEN 'quarter' THEN p.base_cents / 3
    WHEN 'week'    THEN (p.base_cents * 52) / 12
  END AS mrr_cents
FROM subscriptions s
JOIN plans p ON p.id = s.plan_id
WHERE s.status IN ('trialing', 'active', 'past_due');
```

Three decisions are visible in that view and are worth naming. We recommend including `trialing` in MRR by default, which is the looser convention; the stricter convention excludes it and produces a smaller, lagged number. We recommend including `past_due` because cancelling a subscription on the first failed payment overstates churn; this is the same convention the SaaS finance literature follows. We exclude `unpaid` and `canceled` because access has stopped. The spec defines both views (`mrr_strict` and `mrr_loose`); v0.4 will emit them on opt-in, today you copy whichever you want into a migration.

We deliberately do not recommend a benchmark for "good" MRR growth, a "typical" net revenue retention, or any other industry number. Public benchmarks vary by stage, segment, and methodology, and citing one as a default would mislead more often than it would help. The profile steers the fixture; the interpretation is yours.

## Churn, which is at least three different metrics

The word "churn" is overloaded. The three metrics that show up in real dashboards are not interchangeable, and a fixture that confuses them will produce reports that disagree with each other.

| Metric | Numerator | Denominator | What it measures |
| --- | --- | --- | --- |
| Logo churn | Subscriptions canceled in period | Subscriptions active at start of period | Customer count attrition |
| Gross revenue churn | MRR lost from cancels + downgrades | MRR at start of period | Worst-case revenue erosion, before expansion |
| Net revenue churn | (MRR lost) − (MRR gained from expansion) | MRR at start of period | True revenue movement, can go negative |

The spec says: generate the events that all three metrics derive from (cancellations, plan changes, quantity changes, downgrades) and join them in a `churn_events` view. Do not put a "churn rate" column on `orgs`, because that number is a window function over the events, not a property of the row. Today the LLM is prompted to produce those event rows; the named view and the joiner module are part of the v0.4 build.

A plausible distribution of cancel reasons, illustrative only, drawn from the profile's recommended defaults:

```text
cancel reason mix, default profile (illustrative shape, not a measurement)
voluntary_no_reason       ████████████  27%
voluntary_too_expensive   ████████      18%
voluntary_missing_feature ██████        14%
voluntary_switching       █████         12%
involuntary_payment_fail  ████████      19%
involuntary_fraud_block   █              2%
other / unknown           ████           8%
```

The "involuntary" rows are the dunning bucket. In most SaaS reports we have seen, involuntary churn is one of the largest single drivers of attrition and almost the only one a billing engineer can fix without a product change. The next section is how the profile specifies it.

## The dunning death spiral

Dunning is the polite name for "what happens after the card declines." A real billing system tries the payment again, then again, then again, on a schedule, and if every retry fails the subscription transitions out of `past_due` into a terminal state. Stripe's default policy retries failed invoices for up to a configurable window before marking the subscription `canceled` or `unpaid`, and exposes the retry schedule as a tunable policy ([Stripe: Smart retries and failed payments](https://docs.stripe.com/billing/revenue-recovery/smart-retries)). Other billing platforms ship similar policies under different names; the shape is industry-standard.

The profile specifies the shape, not any one vendor's exact schedule: one `invoice` row per attempt with the status appropriate to the outcome, on a curve like the one below. Today the LLM is prompted to produce attempts in this shape and the validator confirms the rows are well-formed; the deterministic per-invoice sampler (`dunning-sampler`) is part of the v0.4 module list, and will replace the LLM's freehand sampling for this slice.

```text
default dunning attempt schedule, sampled per failed invoice
attempt 1   day 0           (initial charge fails)
attempt 2   day 3
attempt 3   day 5
attempt 4   day 7
attempt 5   day 14
attempt 6   day 21
terminal    day 28          (canceled or unpaid, per org policy)
```

The terminal transition is the death spiral, and it is shaped like an exponential decay over the customer base: a sizeable fraction of failed payments recover on attempt 2 or 3, a smaller fraction recover later, and an irreducible tail never recovers and transitions out. The spec calls for sampling a recovery probability per attempt with the curve highest early and flattening fast, so the resulting fixture has a mix of recovered and abandoned subscriptions that exercises both code paths.

What this gives you in practice, once you have the recommended constraints in place and the v0.4 sampler enabled (or the LLM is on a good day), is a fixture in which the dunning job has actual work to do: real `past_due` rows with real attempt histories, real terminal transitions on the correct day, real invoice rows whose `attempt_count` field is more than 1, and a reconciliation between `mrr_loose` at the start of the period and `mrr_loose` at the end that closes when you account for new subscriptions, cancellations, plan changes, and the dunning tail.

## Usage events, on a Poisson curve

Usage-based billing is the part of a SaaS schema that uniform fixtures hurt the most. Real usage is bursty: most accounts emit few events most of the time, a small minority emit many, and within a single account usage clusters by hour-of-day in the customer's local time. The spec calls for sampling arrival times for `usage_events` from a Poisson process per account, with the rate drawn from a log-normal across accounts and modulated by an hour-of-day curve borrowed from the appointments profile. Today the prompt asks the LLM to honour this shape and the validator checks the rows fit the schema; the deterministic `poisson-usage` sampler is on the v0.4 list and will take this over from the model.

The arithmetic the fixture has to honour is then:

```text
invoices.amount_cents
  = plan.base_cents
  + sum(usage_events.quantity × plan.unit_price_cents)
    over (usage_events.occurred_at in [period_start, period_end))
```

If you have followed the recommendation above and made `invoices.total_cents` a generated column, the database enforces a stricter version of the same statement on every write, the application cannot drift from it, and the finance dashboard you build on top reports numbers that close. Until the v0.4 reconciler ships, the generated column is the single most important guard rail for this profile.

## State-flag columns, briefly

Subscriptions carry the longest list of timestamp-shaped state-flag columns of any table in a typical SaaS schema. Restating the table from [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question) for ease of reference:

| Profile | State-flag columns hit | Median `frac_null` | Range |
| --- | --- | --- | --- |
| saas-subscriptions | 12 | 0.97 | 0.90 – 0.995 |
| medical-booking | 7 | 0.94 | 0.85 – 0.99 |
| ecommerce | 9 | 0.96 | 0.88 – 0.99 |

Twelve columns is the typical SaaS subscription table's `trial_started_at`, `trial_ended_at`, `activated_at`, `current_period_start`, `current_period_end`, `cancel_at`, `canceled_at`, `ended_at`, `pause_collection_at`, `pause_collection_resumes_at`, `latest_invoice_paid_at`, and `latest_invoice_attempted_at`. Most of them are NULL for most rows because most subscriptions are in `active` and have not yet reached the terminal states that fill them. The 0.97 median is the heuristic talking, not a measurement of your schema.

## What the profile deliberately does not encode

We get asked for each of these regularly. The reasons matter more than the list.

- **Pricing.** We do not generate plan prices, ladder breakpoints, or unit prices. Pricing is the most product-specific decision in a SaaS schema and the one least useful to default. The profile expects you to populate the `plans` table yourself (a one-time `psql -f plans.sql` against the target database before `satus generate` runs), and it generates everything downstream from your real prices.
- **Tax.** We will populate a `tax_cents` column with a plausible value relative to the subtotal, but we do not compute jurisdiction-correct tax. A fixture that gets US sales tax structurally right is one bad rounding rule away from a fixture that gets it confidently wrong; the right place to test tax is against a real tax service in a staging environment.
- **Card data.** We never generate card numbers, even test ones. If a column is named like a card number we fill it with the all-zeros placeholder and warn at plan time. Test card numbers are a payment-processor concern, not a seeder concern.
- **Cohort retention curves.** We generate the events from which a cohort report can be built and we do not ship a cohort table; that is a reporting concern, not a schema concern.
- **Multi-currency settlement.** We sample a `currency` column from a weighted categorical using ISO 4217 alphabetic codes ([ISO 4217](https://www.iso.org/iso-4217-currency-codes.html)) and we do not generate exchange-rate tables, settlement ledgers, or base-currency conversions. The right model depends on whether you settle in the customer's currency or your own.
- **Webhook event streams.** Out of scope for v1. Plausibly a future opt-in for users testing webhook-handler pipelines.

A user who needs any of these can override the relevant column or supply the relevant input. We will help. We will not ship them on by default.

## How to inspect what you are getting

One command covers most questions.

```bash
# Plan a run without writing rows; walks the schema, simulates the rows
# the live planner would produce, and validates them against every
# NOT NULL, type, range, length, and FK constraint.
satus generate --profile saas --schema public --dry-run
```

`satus generate --dry-run` runs the full plan offline without spending a token on the LLM. The transcript and what it catches is the subject of [an offline dry-run that catches FK and constraint bugs before spending on an LLM](/blog/dry-run-validation).

## The shorter version

A SaaS-subscriptions profile is mostly a state machine, an arithmetic identity, and a retry schedule. The state machine is `trialing → active → past_due → unpaid/canceled` with the legal back-edges and no others. The arithmetic identity is `invoice.total = plan.base + sum(usage × unit_price)`, enforced by a generated column where the schema allows. The retry schedule is the dunning curve, sampled per failed invoice, terminating in either recovery or cancellation. Encode those three correctly and the rest of the profile (Poisson usage, Zipf-ish account sizes, log-normal trial lengths) is parameter-fitting. Encode them as uniform random and the planner, the dashboards, and the dunning job will all behave qualitatively differently in production than they did in test.

In v0.3 those three are LLM-guided and validator-checked; in v0.4 the state-machine enforcer, the dunning sampler, the Poisson usage generator, and the canonical MRR/churn views move into the CLI as deterministic modules. This post is the contract that build will honour.

If you are seeding a SaaS-shaped schema and the recommended defaults are wrong for your stage, override the bits that matter (the status mix, the dunning curve, the usage rate) and leave the rest. The [/profiles](/profiles#saas-subscriptions) page lists the three built-ins, the [/quickstart](/quickstart) shows how to point the CLI at your schema, and the [/recipes](/recipes) page has a worked example of a profile override.

## References

- Stripe, [The Subscription object](https://docs.stripe.com/api/subscriptions/object).
- Stripe, [Smart retries and failed payments](https://docs.stripe.com/billing/revenue-recovery/smart-retries).
- PostgreSQL documentation, [Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html).
- PostgreSQL documentation, [Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html).
- PostgreSQL documentation, [CHECK Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).
- ISO, [4217 Currency codes](https://www.iso.org/iso-4217-currency-codes.html).
- Earlier in this log: [Inside the medical-booking profile](/blog/medical-booking-profile), [Inside the e-commerce profile](/blog/ecommerce-profile), [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), [Enum types that grew up](/blog/enum-types-that-grew-up), [An offline --dry-run that catches FK and constraint bugs before spending on an LLM](/blog/dry-run-validation).

—the satus.sh team
