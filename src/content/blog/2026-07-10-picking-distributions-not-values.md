---
slug: picking-distributions-not-values
title: "Profile design 101: pick distributions, not values"
description: The heuristic we use when adding a new vertical to satus. Name the distributions and the correlations first, then, and only then, sample values. An internal design doc, published.
date: 2026-07-10
author: satus.sh
tags: [profile, methodology, distributions, postgres, seeding]
draft: false
---

> **Editor's note (2026-07-16):** References to a `medical-booking` profile and to profiles that "carry conditioners" describe design intent from mid-2026. The shipped CLI (v0.3.5) uses simpler prompt-based profiles — `saas`, `ecommerce`, `b2b` — see [/profiles](/profiles). The distribution-modeling argument (correlate, don't sample independently) is the durable point.



When we design a new profile for [satus](/), we do not start with sample rows. We start with a list of column shapes, a distribution family for each shape, and a shorter list of correlations between them. Values are the last thing we write, because values without a distribution behind them are trivia, and trivia is what generic fakers already ship. This post is the internal design doc we hand a new contributor on their first day, made public without much editing.

The doc leans on three earlier posts. The critique of value-first fakers lives in [When faker is the wrong answer](/blog/when-faker-is-the-wrong-answer). The reason a fixture has to match Postgres's planner statistics, not just its constraints, is in the [ecommerce profile deep-dive](/blog/ecommerce-profile). The state-flag heuristic that lets us fill most timestamp columns with NULL without lying is in [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question). If you have read those three, the rest of this post is the workflow that ties them together.

## The heuristic in one sentence

A profile is a list of opinions about distribution shape, ranked by how badly a wrong opinion breaks the downstream code. Everything else, including the pool of fake company names and the choice of `.99` versus `.49` for price endings, is downstream of that list.

We enforce this by writing the profile in a fixed order:

1. Enumerate the shapes the schema contains.
2. Pick a distribution family per shape.
3. Name the correlations between shapes.
4. Name the things you refuse to encode.
5. Only then, choose the sampling pools that produce the values.

Steps 1 through 4 are where a profile earns its keep. Step 5 is where a profile looks like a faker to somebody skimming the YAML, which is why the discipline of doing 1 through 4 first has to be written down.

## Step 1: enumerate the shapes

A "shape" is a distribution family that recurs across schemas, not a specific column. Every profile we have shipped is built out of the same short list. We keep the list short on purpose, because a longer list produces a knob-heavy configuration surface that new users cannot reason about.

| Shape family | Where it shows up | Wrong default that hurts |
| --- | --- | --- |
| Popularity over a set | catalogs, providers, tenants, tags | uniform (every SKU equally popular) |
| Count per parent | items per order, appointments per patient, seats per account | normal around a small mean |
| Duration | appointment length, session length, invoice age | uniform over a range |
| Time-of-day | order placement, login, message send | uniform over 24 hours |
| Day-of-week and seasonality | orders, appointments, signups | flat calendar |
| Terminal-state mix | order status, subscription status, ticket state | equal-weight categorical |
| Monetary value | price, invoice total, contract value | uniform in cents |
| Rare-event rate | no-shows, chargebacks, refunds, churn | too rare to appear at fixture size |
| Geographic mix | country, currency, locale | US-only, or perfectly even |

Nine families, three of which (popularity, count per parent, rare-event rate) do most of the damage when they are wrong. If a new vertical has a shape that does not fit into this list, the first question is not "what distribution should we add", it is "are we sure this is a shape, or is it a value pool wearing a shape's clothes". More often than not, a proposed new shape collapses into one of the nine above once you write out how you would sample from it.

## Step 2: pick a distribution family per shape

For each shape we default to one distribution family, parameterised as coarsely as we can get away with. The defaults matter because most users never override them.

| Shape family | Default family | Why this one |
| --- | --- | --- |
| Popularity | Zipf (discrete power law) | appears across catalogs, content, and search ([Wikipedia: Zipf's law](https://en.wikipedia.org/wiki/Zipf%27s_law); Newman's review, [arXiv:cond-mat/0412004](https://arxiv.org/abs/cond-mat/0412004)) |
| Count per parent | shifted Zipf or geometric | mode at 1, thin right tail, matches basket-size and appointments-per-patient telemetry |
| Duration | log-normal | positive, skewed, one shape parameter ([Wikipedia: Log-normal](https://en.wikipedia.org/wiki/Log-normal_distribution)) |
| Time-of-day | bimodal triangular in local time | cheap to sample, correct on the qualitative shape, no seasonal hyperparameters |
| Day-of-week | per-day multiplier over a base rate | one number per day, trivially overrideable |
| Seasonality | per-month multiplier | same reason as day-of-week; explicit, not learned |
| Terminal-state mix | weighted categorical | the only shape a categorical is honest for |
| Monetary value | log-normal in minor units | matches price distributions across every catalog we have looked at |
| Rare-event rate | Bernoulli per row, per category if needed | one probability per category, easy to tune |
| Geographic mix | weighted categorical | reflect where the traffic actually is, not where the map is symmetric |

The rule for choosing between two candidate families is: pick the one with fewer parameters that reproduces the qualitative shape. A Zipf with one exponent beats a fitted mixture of two normals every time, because the exponent survives being overridden by a user who has never opened a stats textbook. The moment a distribution needs three parameters to be useful, we have almost certainly picked the wrong family.

## Step 3: name the correlations

Distributions in isolation are the easy half. The hard half is that shapes in a real system correlate with each other, and a profile that samples each column independently produces rows that are individually plausible and jointly ridiculous. A few we always ask about when scoping a new vertical:

- Time-of-day correlates with day-of-week. Weekend traffic has a different intra-day curve than weekday traffic. In the medical profile, Saturday's peak is earlier than a weekday's; in ecommerce, the evening peak is later on Friday and Saturday than mid-week.
- Seasonality correlates with rare-event rate. Holiday-season orders return at a higher rate than the annual mean; Q4-signed SaaS contracts churn at a different rate than Q2-signed ones.
- Popularity correlates with category. In ecommerce, the top decile of SKUs is not evenly spread across categories; in SaaS, the top decile of tenants is not evenly spread across plans.
- Count per parent correlates with popularity. Heavy accounts have more of everything: more users, more sessions, more invoices, more support tickets. A fixture that samples these independently produces a distribution of "how much does the top tenant use us" that is much narrower than reality.

We write the correlations down as a small block at the top of the profile, and the runner enforces them by conditioning later samples on earlier ones. The three shipped profiles, [ecommerce](/blog/ecommerce-profile), [medical-booking](/blog/medical-booking-profile), and [SaaS-subscriptions](/blog/saas-subscriptions-profile), each carry a handful of these conditioners. Every one of them was added because a user reported a fixture that was individually correct and jointly wrong.

## Step 4: name what you refuse to encode

Every profile ships with a short section headed "does not encode". This is not a disclaimer; it is a design decision. Anything on that list is something a user can override in their own profile file, but that we refuse to make the default because the right default depends on facts we do not have.

Recurring entries on the "does not encode" list:

- Real proper nouns. No real customer names, real product SKUs, real clinic names, real domains. Synthetic pools only. This is [also our stance on PII](/blog/when-faker-is-the-wrong-answer) and it does not change per vertical.
- Payment instrument data. No card numbers, no IBANs, no routing numbers, ever. If a column is named like one of these we fill zeros and warn at plan time.
- Category-specific overrides where the categories are user-defined. A `fashion` sub-profile inside `ecommerce` would be wrong for the user who asked for `streetwear`; a `dermatology` sub-profile inside `medical-booking` would be wrong for the user who asked for `teledermatology`. Categories belong in user overrides.
- Numbers we cannot cite. If the honest citation would be "a vendor blog post from 2019", we do not embed the number. We embed a shape and hedge the magnitude.

Writing this section forces the profile author to be explicit about the difference between "we have not shipped this yet" and "we have decided not to ship this". The two are treated very differently in issue triage.

## Step 5: choose the value pools last

Only after steps 1 through 4 are on paper do we open a fake-data library and pick pools for names, cities, product descriptors, and so on. The pools are the least load-bearing choice in the profile and by far the most visible, which is the reason a value-first design keeps producing profiles that look plausible on the surface and behave wrong under load. A weighted-categorical over `["US", "GB", "DE", "FR", "JP", "other"]` is a shape decision; the specific city names that go with each country are a pool decision. Getting the shape wrong makes the planner statistics wrong. Getting the pool wrong makes a screenshot look slightly less impressive.

The distinction shows up cleanly in what fails a code review. We reject a PR that sets `US 0.25, GB 0.25, DE 0.25, FR 0.25` as the country weights, because that is a shape decision made without reference to any traffic we have ever seen. We do not reject a PR that swaps one plausible city list for another.

## A worked micro-example: a logistics profile in one page

To make the process concrete, here is what we would sketch on a whiteboard if a user asked us to add a `logistics` profile tomorrow. This is not a shipped profile and the numbers are illustrative.

**Shapes present:** popularity (lanes, carriers), count per parent (shipments per customer), duration (transit time), time-of-day (pickup, delivery), day-of-week and seasonality (peak season), terminal-state mix (delivered, delayed, lost, returned), monetary value (shipment cost), rare-event rate (loss, damage), geographic mix (origin and destination country pairs).

**Distribution families:**

```text
lane popularity         Zipf, s ≈ 0.9
carrier popularity      Zipf, s ≈ 0.6
shipments per customer  shifted Zipf, mode 1, p99 ≈ 40
transit time (days)     log-normal, median 3, p95 ≈ 12
pickup time-of-day      bimodal triangular in local, peaks 09:00 / 15:00
day-of-week             Mon 1.05, Tue-Thu 1.10, Fri 1.15, Sat 0.60, Sun 0.15
seasonality             Nov 1.35, Dec 1.40, Jan 0.80, others 1.00
status mix              in_transit 0.15, delivered 0.78, delayed 0.04,
                         lost 0.005, returned 0.025
shipment cost           log-normal in cents, median 42.00, p95 ≈ 480.00
loss rate               Bernoulli, 0.005 baseline, 3x on lanes flagged fragile
country-pair mix        weighted categorical over top ~30 lanes
```

**Correlations to enforce:**

```text
transit time            conditioned on origin-destination pair
status mix              conditioned on transit-time percentile (a shipment
                         at the 99th percentile of transit time has a higher
                         P(delayed) and P(lost))
seasonality             pushes both order count AND transit time upward
                         (peak season is slower per shipment, not just busier)
```

**Does not encode:** real carrier names, real tracking-number formats, real airport codes as anything other than a neutral three-letter pool, harmonised tariff codes, customs paperwork, insurance riders.

That whiteboard sketch, plus a day of writing tests against a real customer's shipments schema, is the whole design phase. The code to sample from those distributions is standard library. The reason we can ship a plausible profile in a week rather than a quarter is that most of the work happens before any code is written.

## The anti-patterns we have learned to avoid

Three anti-patterns keep showing up in profile PRs, ours and contributors', and all three are variations on skipping step 1.

The first is the "sample rows" PR. Somebody opens the file, sees a section of YAML, and adds ten literal example rows to it. Ten rows do not constitute a distribution; they constitute a very small pool. If we merged the PR the fixture would be indistinguishable from the input rows at scale, and the planner would learn statistics from a ten-row multiset. We reject these and ask for a distribution family instead.

The second is the "one big categorical" PR. Somebody replaces a Zipf or log-normal with a weighted categorical over twenty buckets, on the grounds that categoricals are easier to reason about. The categorical is easier to reason about, and it is also flat inside each bucket, and inside-bucket flatness is exactly the failure mode a Zipf was chosen to avoid.

The third is the "make it configurable" PR. Somebody adds three new knobs to a distribution because their specific use case wants them. Every knob is a knob a future user will have to reason about and get wrong, and knobs multiply. We ship the coarsest parameterisation we can defend and push per-use-case tuning into user override files, which do not need a satus release to change.

## The checklist

Before merging a new profile, a contributor confirms all of the following, in this order:

- The nine (or so) shape families are enumerated, and any shape not on the standard list is justified in the PR description.
- Each shape has a distribution family with one or two parameters, defended in a comment above it.
- Correlations are named and enforced in the runner, not left to the reader to notice.
- The "does not encode" section is present and specific.
- Value pools are last in the file and short.
- The corpus-style structural claims (schema counts, table counts, and so on) in the accompanying blog post cite our own [corpus](https://github.com/PasskeyBridge-LLC/satus/tree/main/corpus) or a named public source, never a vendor blog.

If any of those is missing, the profile is not ready. The runner will accept it, the tests will pass, and it will silently be another value-first faker with slightly better packaging. Nobody needs another one of those.

## The shorter version

Values are the noise. Distributions are the signal. Correlations are the difference between rows that are individually plausible and a fixture that is jointly plausible. Refusals are the difference between a design decision and a backlog item.

If you want to see the process applied to real schemas, the [profiles page](/profiles) lists the three profiles we ship today, and the [quickstart](/quickstart) walks through pointing satus at your own schema. If you are building a profile for a vertical we do not ship yet, this post is the workflow. Send us the sketch; we will read it.

## References

- PostgreSQL documentation, [Statistics Used by the Planner](https://www.postgresql.org/docs/current/planner-stats.html).
- Wikipedia, [Zipf's law](https://en.wikipedia.org/wiki/Zipf%27s_law).
- M. E. J. Newman, "Power laws, Pareto distributions and Zipf's law", 2004, [arXiv:cond-mat/0412004](https://arxiv.org/abs/cond-mat/0412004).
- Wikipedia, [Log-normal distribution](https://en.wikipedia.org/wiki/Log-normal_distribution).
- PostgreSQL documentation, [Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).
