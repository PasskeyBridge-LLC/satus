---
slug: ecommerce-profile
title: "Inside the e-commerce profile: SKUs, carts, and the long tail of returns"
seoTitle: The satus e-commerce profile: SKUs, carts and returns
description: Catalog distributions, basket sizes, return rates and seasonality in the satus e-commerce profile, and why it has no fashion-vs-electronics switch.
date: 2026-06-15
author: satus.sh
tags: [profile, ecommerce, distributions, postgres, seeding]
draft: false
---

> **Editor's note (2026-07-16):** This post describes profile-system design intent from mid-2026. The shipped CLI (v0.3.5) uses prompt-based profiles — `saas`, `ecommerce`, `b2b` — with no YAML profile files or per-profile invariant enforcement beyond the user's Postgres constraints. See [/profiles](/profiles) for the current behavior. The post is preserved for its distribution-modeling arguments.



A consumer e-commerce schema is mostly three tables wearing trench coats: a catalog, a basket, and an order log. Each of those tables is dominated by a distribution that almost no uniformly random seeder reproduces. Catalogs are long-tailed: a small minority of SKUs absorb most of the traffic. Baskets are power-law-ish: most are one item, a few are five, and one in a thousand looks like somebody refreshing the page after the holiday email landed. Returns concentrate around a small set of categories and a small set of weeks. If your tests, dashboards, or planner statistics depend on those shapes, the default uniform fixture is silently wrong, and the wrongness only becomes visible once you have shipped. The `ecommerce` profile in [satus](/) is the choices we made about which of those shapes to encode by default and which to leave to you. This post is the inventory.

The shape of this post mirrors the [medical-booking deep-dive](/blog/medical-booking-profile): the distributions baked in, the constraints we lean on, and the things we deliberately decline to ship. The constraints discussion assumes you have read [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild). The seasonality section builds on [Three timezone bugs we found by seeding production-shaped data](/blog/timezone-bugs-found-by-seed-data); if you have not read that one, the short version is that ecommerce traffic has the same hour-of-day curve as appointments and the same need to respect the customer's local time, not the server's.

## Why a uniform fixture is the wrong fixture

A uniformly random ecommerce fixture has every column populated, every foreign key resolved, and no row that would offend a CHECK constraint. It also has a catalog where every SKU has identical traffic, baskets that are normally distributed around three items, and returns scattered evenly across the year. Three things break the moment you point a real query plan at it.

First, the query planner. Postgres's planner statistics live in `pg_statistic` and are summarised in `pg_stats`; the planner uses them to estimate selectivity for every WHERE clause involving an indexed column ([PostgreSQL documentation: Statistics Used by the Planner](https://www.postgresql.org/docs/current/planner-stats.html)). A flat catalog produces flat statistics, and flat statistics produce plans that are wrong in exactly the cases where production hurts: the popular SKU, the popular country, the popular size.

Second, the application's own caching and fan-out logic. Code paths that assume a 90/10 split between hot and cold SKUs are never exercised by a fixture without a hot/cold split. Code paths that assume bulk baskets are rare are never exercised by a fixture where baskets are normally distributed. Bugs in those code paths surface in production at exactly the rate the fixture failed to model them.

Third, the back-office and finance integrations. Returns, refunds, chargebacks, and tax adjustments are correlated with each other in time, with promotional events, and with category. A fixture that scatters them uniformly produces a reconciliation report that looks healthy and is, in a structural sense, fiction.

## What the profile encodes

The profile is a YAML document the CLI reads at planning time. It is intentionally coarse: the goal is one defensible curve per shape, not a dial-rich configuration surface that the user has to tune before the first run. Distributions can be overridden per column or per table; the defaults below are what you get if you do nothing.

| Shape | Encoded as | Default | Notes |
| --- | --- | --- | --- |
| SKU popularity | Zipf over catalog rows | exponent s ≈ 0.8 | over 10k SKUs: top 5% carry ≈ 48% of orders, bottom 50% carry ≈ 15% |
| Catalog size growth | log-normal over `created_at` | median age ≈ 9 months | new SKUs are rarer than old ones, with a recent-launch bump |
| Price | log-normal in currency minor units | median ≈ 24.00, p95 ≈ 199.00 | snapped to .99 / .49 / .00 endings, clamped to schema CHECK if present |
| Basket size | shifted-Zipf in items per order | mode = 1, p95 = 5, p99.9 ≈ 22 | the long right tail is the point |
| Hour-of-day | bimodal triangular in local time | peaks 12:00 and 20:00, floor 06:00, ceiling 24:00 | local to the customer's billing-address country, not UTC |
| Day-of-week | weighted per-day multiplier | Mon–Thu 1.0, Fri 1.15, Sat 1.20, Sun 1.10 | not a hard rule, easy to override per profile |
| Seasonality | per-month multiplier | Nov 1.45, Dec 1.55, Jan 0.85, Feb 0.80 | calendar-driven, no specific event named |
| Order status | weighted categorical | placed 0.04, paid 0.78, fulfilled 0.10, refunded 0.05, cancelled 0.03 | terminal states only; mid-flight rows clipped at sample window |
| Return rate | per-category override | apparel 0.20, electronics 0.08, home 0.05, other 0.07 | applied as a post-pass over fulfilled rows |
| Country | weighted categorical | US 0.42, GB 0.11, DE 0.09, FR 0.06, JP 0.05, other 0.27 | matches the spoken locales in the prompt |

The Zipf distribution for SKU popularity is the load-bearing choice in this profile, and it is the one that most often surprises users coming from uniform fixtures. Zipf is a discrete power law in which the frequency of the k-th most popular item is proportional to 1/k^s, and it appears in catalog telemetry across consumer commerce, content recommendation, and search ([Wikipedia: Zipf's law](https://en.wikipedia.org/wiki/Zipf%27s_law), with the canonical reference being Newman's review of power laws in empirical data, [arXiv:cond-mat/0412004](https://arxiv.org/abs/cond-mat/0412004)). The "long tail" framing from Anderson's 2004 essay in *Wired* is downstream of the same shape ([Anderson, "The Long Tail", *Wired* 12.10, October 2004](https://www.wired.com/2004/10/tail/)). We do not claim s ≈ 0.8 is the right exponent for your catalog; we claim it is closer than s = 0 (uniform) for almost any catalog.

A quick visualisation of the default SKU popularity curve over a 10,000-SKU catalog, bucketed by decile of rank:

```text
share of orders by SKU popularity decile (Zipf s=0.8, 10k SKUs)
top 0–10%   ████████████████████████████  57%
10–20%      █████                         11%
20–30%      ████                           7%
30–40%      ███                            5%
40–50%      ██                             4%
50–60%      ██                             4%
60–70%      ██                             3%
70–80%      █                              3%
80–90%      █                              3%
90–100%     █                              2%
```

The top decile carries roughly 57% of the volume. The bottom 50% of the catalog together carry roughly 15%. A uniform fixture flattens this into ten 10% bars; the planner sees a different table.

## Basket size, which is where most schemas hide their bugs

Basket size in real stores is a power-law-ish discrete distribution. The mode is one item. Two-item baskets are common. Three-, four-, and five-item baskets exist and get rarer fast. Beyond ten items the distribution does not go to zero; it goes to a thin long tail of baskets in the dozens that are typically a B2B account stocking up, a wedding registry checkout, or somebody refreshing the page after a marketing email lands and pricing changes mid-session.

The profile samples basket size from a shifted Zipf with a small additive constant so the mode lands cleanly at 1:

```text
items per order, default profile (illustrative shape, not a measurement)
 1 item   ████████████████████████████████████████  62%
 2        ██████████████████                        22%
 3        █████████                                  9%
 4        ████                                       4%
 5        ██                                         2%
 6        █                                          0.6%
 7–10     █                                          0.3%
 11–25                                               <0.1%
 26+                                                 <0.01% (rare, not zero)
```

The "rare, not zero" row in the long tail is the row that catches code paths the team forgot existed. We have watched the same bug get reported twice: a checkout endpoint that builds a single SQL statement per line item, hits the prepared-statement parameter limit somewhere north of 65 thousand placeholders ([PostgreSQL documentation: Frontend/Backend Protocol — Bind](https://www.postgresql.org/docs/current/protocol-message-formats.html)), and 500s on a basket that production has actually seen. Uniform fixtures never produced the row that reproduces the bug.

## Returns and the long tail of categories

Return rates are heterogeneous in a way that matters more than the headline number. Apparel returns at multiples of the rate of electronics, which returns at multiples of the rate of consumables. Within apparel, footwear and outerwear sit above the category mean; within electronics, accessories sit below the mean. We encode this as a per-category rate, not a single store-wide rate, because the difference between "5% returns across the store" and "20% returns concentrated in one category" is the difference between a finance dashboard that is broadly right and one that is broadly wrong.

We do not embed specific industry numbers as defaults. Published trade-association estimates of overall retail return rates exist, but the methodology varies across studies and across years, so the per-category defaults the profile ships are deliberately our own opinion calibrated to land inside the published ranges. The values you should care about are the relative magnitudes, not the absolute percentages; the rates are easy to override.

Returns also cluster in time. The seasonality multipliers above push orders into November and December; the profile then concentrates the corresponding returns into the following four to six weeks. This is the single most useful thing a fixture can do for a Q1 finance team: produce a January in which the refund table is busy and the order table is not, because that is what their reconciliation actually looks like.

## Constraints we recommend, and sometimes generate

The profile is more useful when the schema has constraints that match its shape. Two we lean on in almost every ecommerce schema we see:

```sql
-- 1. Money never goes negative; line totals add up.
ALTER TABLE order_items
  ADD CONSTRAINT order_item_amounts_nonneg
  CHECK (quantity > 0 AND unit_price_cents >= 0 AND line_total_cents >= 0);

-- 2. line_total is derived; make it a generated column so the seeder
--    cannot disagree with the application.
ALTER TABLE order_items
  ADD COLUMN line_total_cents bigint
  GENERATED ALWAYS AS (quantity * unit_price_cents) STORED;
```

The first is a plain `CHECK` and we always honour it. The second is a `GENERATED ALWAYS AS ... STORED` column, which Postgres has shipped since version 12 ([PostgreSQL documentation: Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html)). When a generated column is present, `satus` never writes to it; the database computes it and the fixture and the application agree by construction. When it is absent, we write a value that satisfies the obvious arithmetic, and we print a planner-time warning that this is the kind of column you almost certainly want generated.

For currency, we store integer minor units (`bigint`, cents) rather than `numeric(10,2)` by default, because integer arithmetic does not lose pennies under aggregation and because that is what a long line of payment-processing literature recommends. The Postgres-side argument is that `numeric` is exact but slow and that floating-point money is a known antipattern ([PostgreSQL Wiki: Don't Do This — Don't use money](https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_money)). If your schema uses `numeric(10,2)` we respect it; if it uses `money` we sample it and we warn.

## Multi-currency, which the profile mostly avoids

A real international store has prices in multiple currencies, exchange rates that drift, and order totals that should be stored in the currency the customer paid in plus a rate snapshot. The profile expresses this only weakly: it samples a `currency` column from a weighted categorical (USD 0.55, EUR 0.20, GBP 0.10, JPY 0.05, other 0.10), uses ISO 4217 alphabetic codes ([ISO 4217](https://www.iso.org/iso-4217-currency-codes.html)), and clamps prices to a sensible per-currency range. It does not generate a rate table, does not vary rates over time, and does not attempt to reconcile a total across currencies. We have been asked to ship a full multi-currency model and have, so far, declined. The reason is that the right model depends on whether your store charges in the customer's currency, settles in a base currency, or both; encoding one of those three opinions as a default would be wrong for the other two.

## What the profile deliberately does not encode

We get asked for each of these regularly. The reasons matter more than the list.

- **Fashion-vs-electronics-vs-grocery switch.** Every category has its own price distribution, return rate, basket size, and seasonality, and we have customers asking for each. We do not ship a category switch because the value of the profile is in the cross-cutting shapes (Zipf catalog, power-law baskets, holiday peaks, category-weighted returns) and the category-specific shapes belong in user overrides where they can be tuned without us shipping a release. A built-in `fashion` profile would be wrong for the next user who asked for `streetwear`.
- **Real product catalogs.** We seed product names from a generic descriptor-and-noun pool and do not reproduce a real retailer's SKU list. Real catalogs are trademarked and frequently licensed; using them by default produces fixtures that look like a particular real store, which is the opposite of what synthetic data should do.
- **Real customer PII.** Names, emails, addresses, and phone numbers are generated from neutral pools and explicitly do not match real records. Addresses are syntactically valid for their country but do not correspond to occupied buildings.
- **Payment instrument data.** We never generate card numbers, even test ones, and we never generate anything that resembles a real bank account, IBAN, or routing number. If a column is named like a card number we fill it with the all-zeros placeholder and warn at plan time. Test card numbers are a payment-processor concern, not a seeder concern, and the safest thing we can ship is nothing at all.
- **Tax tables.** We will populate a `tax_cents` column with a plausible value relative to the line total, but we do not attempt to compute jurisdiction-correct tax. A fixture that gets California sales tax structurally right is one bad rounding rule away from a fixture that gets it confidently wrong, and the right place to test tax is against a real tax service in a staging environment.
- **Inventory and stock movements.** Out of scope for v1. Plausibly a future `inventory` profile if enough users ask for it.

A user who needs any of these can override the relevant column in their own profile file. We will help. We will not ship them on by default.

## State-flag columns, briefly

The `ecommerce` profile, like the others, leans on the heuristic introduced in [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question) for filling timestamp-shaped state-flag columns. Restating the table from that post for ease of reference:

| Profile | State-flag columns hit | Median `frac_null` | Range |
| --- | --- | --- | --- |
| saas-subscriptions | 12 | 0.97 | 0.90 – 0.995 |
| medical-booking | 7 | 0.94 | 0.85 – 0.99 |
| ecommerce | 9 | 0.96 | 0.88 – 0.99 |

Nine columns is the typical ecommerce schema's set of `paid_at`, `fulfilled_at`, `shipped_at`, `delivered_at`, `cancelled_at`, `refund_requested_at`, `refunded_at`, `chargeback_at`, and `dispute_resolved_at`. Most of them are NULL for most rows because most rows do not reach the terminal state that fills them, which is exactly the point of the heuristic.

## How to inspect what you are getting

Two commands cover most questions.

```bash
# Dump the resolved profile (defaults + your overrides) as JSON.
satus profile show ecommerce --resolved

# Plan a run without writing rows; prints the distribution
# satus will sample from for every column it touches.
satus plan --profile ecommerce --schema shop
```

`satus plan` annotates each column with the distribution name, the parameters, and the source: default, profile override, or schema-derived. If a number in your fixture looks wrong, the plan output is where to look first. The hour-of-day and seasonality samplers are on by default for every built-in profile, so you can verify before any row is written that the planner is going to do what you expect.

## The shorter version

An ecommerce profile is mostly a list of opinions about distribution shape. The opinions are: catalogs are long-tailed; baskets are mostly one item with a heavy right tail; orders cluster in the customer's evening hours and in the back half of the calendar year; returns concentrate by category and by week; and money is an integer. Encoding those opinions turns out to be much more of the value than any single curve, because the planner, the application code, and the finance dashboards all behave qualitatively differently against power-law data than against uniform data.

If you are seeding an ecommerce-shaped schema and the default profile is wrong for your category, override the bits that matter and leave the rest. If you want a profile we do not yet ship, the [/profiles](/profiles) page lists the three built-ins, the [/quickstart](/quickstart) shows how to point the CLI at your schema, and the [/recipes](/recipes) page has a worked example of a profile override.

## References

- PostgreSQL documentation, [Statistics Used by the Planner](https://www.postgresql.org/docs/current/planner-stats.html).
- PostgreSQL documentation, [Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html).
- PostgreSQL documentation, [Frontend/Backend Protocol — Message Formats](https://www.postgresql.org/docs/current/protocol-message-formats.html).
- PostgreSQL Wiki, [Don't Do This — Don't use money](https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_money).
- ISO, [4217 Currency codes](https://www.iso.org/iso-4217-currency-codes.html).
- Newman, M. E. J. (2005), "Power laws, Pareto distributions and Zipf's law", *Contemporary Physics* 46(5):323–351. [arXiv:cond-mat/0412004](https://arxiv.org/abs/cond-mat/0412004).
- Anderson, C. (2004), "The Long Tail", *Wired* 12.10. [Original article](https://www.wired.com/2004/10/tail/).
- Wikipedia, [Zipf's law](https://en.wikipedia.org/wiki/Zipf%27s_law).
- Earlier in this log: [Inside the medical-booking profile](/blog/medical-booking-profile), [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), [Three timezone bugs we found by seeding production-shaped data](/blog/timezone-bugs-found-by-seed-data), [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild).

—the satus.sh team
