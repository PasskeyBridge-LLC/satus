---
slug: free-tier-priced-honestly
title: Free tier, priced honestly
description: Why the free tier is 25 rows across 5 tables, why those 5 tables are never arbitrary, and the two integers that are the whole difference between Free and Pro.
date: 2026-09-18
publishAt: 2026-09-18T09:00:00-04:00
author: satus.sh
tags: [pricing, product, cli]
draft: false
---

satus is free up to 25 rows per table across 5 tables, with no time limit and no card. Above that it is $19 a month. This post is about how those two numbers were chosen, what they do and do not restrict, and what "fully offline" means on Free.

## The whole of the paid gate

Every difference between Free and Pro lives in one variable, and that variable is consulted exactly three times in the codebase:

```text
187:  const isPaid = license?.valid && (license.plan === "pro" || license.plan === "team");
189:  const rowsPerTable = isPaid ? requestedRows : Math.min(requestedRows, FREE_MAX_ROWS);
190:  if (!isPaid && requestedRows > FREE_MAX_ROWS) {
282:  if (!isPaid && ordered.length > FREE_MAX_TABLES) {
```

A clamp on rows, a clamp on tables, and the warnings that announce them. That is the entire commercial boundary.

It follows that everything else is the same binary. The 10,000-row [production safety guard](/blog/v0-3-8-release-notes) runs on Free. So does the relational validator, [`--dry-run`](/cli) with its exit code `2` for CI, the [foreign-key cycle handling](/blog/cyclic-fks-in-the-wild) and its exit code `10`, `--json` output, both providers, and all three [profiles](/profiles) (`saas`, `ecommerce`, `b2b`). There is no profile behind the paywall and never has been. If a bug is fixed, it is fixed for Free on the same release.

Here are both caps firing on a seven-table schema:

```text
! Free tier capped at 25 rows/table (you asked for 50). Run `satus activate <key>` to unlock.
! Free tier capped at 5 tables (schema has 7). Run `satus activate <key>` to unlock all tables.

satus generate
  schema:   public
  profile:  saas
  rows:     25 per table
  tables:   orgs -> projects -> users -> tasks -> audit_log
```

## The 5 tables are never an arbitrary 5

The cap is `ordered.slice(0, FREE_MAX_TABLES)` with `FREE_MAX_TABLES` at 5, and `ordered` is the topological sort, not the schema's alphabetical or `pg_class` order. That distinction is doing real work.

A prefix of a topological order is closed under the parent relation. Every table's foreign-key targets sort before it, so if a table is in the first five, everything it references is too. Truncation therefore cannot produce an orphan: you get a smaller schema that still satisfies its own constraints, rather than five tables with dangling references.

In the run above, the schema was `orgs, users, projects, tasks, comments, attachments, audit_log`. What survived was `orgs -> projects -> users -> tasks -> audit_log`; `comments` and `attachments` were dropped. Those two are the leaves of the chain `tasks -> comments -> attachments`. Nothing that was kept pointed at anything that was cut, and that is guaranteed by the ordering rather than by luck.

The one case needing care is a broken foreign-key cycle, where the back-edge target can fall outside the prefix. The runner filters those out before the back-patch pass rather than trying to update a table it never seeded.

## Why 25 and 5

The honest answer is that the numbers are a judgement about when you have seen the product, not a cost recovery calculation.

125 rows is enough to open a table in `psql`, or your app, and check whether the data looks like your product. It is enough for foreign keys to resolve across several tables, for a unique constraint to actually collide if the generation is bad, and for the validator to have something to say. It is not enough to fill a dashboard for a demo, or to run a load test, or to stand in for a staging fixture. That is where the line sits, and it is drawn at "you can evaluate this" rather than "you can ship with this."

The cost recovery argument does not exist, because [a 125-row run costs about seven hundredths of a cent](/blog/how-the-dry-run-cost-estimate-is-calculated) and you pay it, not us. You bring your own OpenAI or Anthropic key. We never proxy your prompts, never hold your key, and never mark up your tokens.

That is also why there is no free *trial*. A time-limited Pro would tell you what the caps feel like when lifted, then take it away. The Free tier tells you what the tool is, permanently, and the caps are the only thing you buy your way out of.

## What Pro is

$19 a month, or $190 a year, both live in Stripe as `satus_pro_monthly` and `satus_pro_yearly`. Annual is a little under ten months at the monthly rate.

You get the caps lifted, and a 24-hour offline license grace: the CLI caches its verdict locally so a flight or a license-server outage does not stop a build. Past 24 hours with no network, activation fails closed and you drop to Free caps with a printed reason rather than silently continuing. That grace has been enforced since [v0.3.10](/blog/v0-3-10-release-notes).

Team is $49 per seat per month. The price exists in Stripe as `satus_team_seat_monthly`; the tier does not exist as a product you can buy. It is a waitlist, the pricing page says so, and it stays a waitlist until enough teams ask for the same handful of features to make it a real tier rather than a bigger number.

## What "fully offline" means on Free

Our pricing FAQ says "Free is fully offline forever." The answer it sits in is about license verification, and there it is exact: Free never contacts the license server, because there is no key to verify.

Read more broadly, it has been exact since v0.3.11. Through v0.3.10 the CLI sent a small run record at the end of `satus generate` on every tier: a run UUID, the CLI version, provider, model, profile, a table *count*, row and token totals, an estimated spend, a duration, and on failure a fixed-vocabulary error class. No schema name, no table or column names, no row data. Since v0.3.11 the run record is opt-in via `telemetry.enabled` or `SATUS_TELEMETRY=1`, `DO_NOT_TRACK=1` overrides both, and the default is pinned by a test. A default install of Free runs without talking to us at all, which is what the sentence says. The [v0.3.11 release notes](/blog/v0-3-11-release-notes) have the detail.

## What would move the caps

Evidence, in one direction only. If people on Free routinely hit 5 tables and stop, the table cap is too tight to demonstrate the thing satus is actually for, which is multi-table referential integrity, and it should go up. Nobody has told us that yet, because the population of Free users who have told us anything is still small enough to count.

What will not move them is revenue pressure. Tightening a free tier to manufacture upgrades is a tax on the people who have not decided yet, and we would rather publish the caps, publish the reasoning, and let the tool be the argument.

## Sources

- Caps and their enforcement: `packages/cli/src/commands/generate.ts` (`FREE_MAX_ROWS`, `FREE_MAX_TABLES`)
- Live prices: `satus_pro_monthly` ($19), `satus_pro_yearly` ($190), `satus_team_seat_monthly` ($49), verified in Stripe on publication day
- [satus.sh/pricing](/pricing) for the current tier matrix
