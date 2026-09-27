---
slug: fixtures-vs-generation-when-each-wins
title: Fixtures vs generation, and when each wins
description: A hand-written fixture passes every test until the first migration. Generated data survives the migration and cannot promise the same row twice.
date: 2026-09-25
publishAt: 2026-09-25T09:00:00-04:00
author: satus.sh
tags: [seeding, testing, fixtures, postgres, cli]
draft: false
---

A seed fixture is a file of rows somebody typed. Generated seed data is a set of rows derived from the schema at run time. Most test suites need both. The common mistake is asking one of them to do the other's job. This post is about where the line falls, with every command below run on PostgreSQL 16.13 against the shipped `@passkeybridge/satus@0.3.11` on the day it published.

## What a fixture is good at

Here is a two-table schema and the kind of fixture most projects carry in a `seed.sql` or a factory file:

```sql
create table customers (
  id    integer generated always as identity primary key,
  email text not null unique,
  name  text not null
);
create table orders (
  id          integer generated always as identity primary key,
  customer_id integer not null references customers(id),
  status      text not null check (status in ('pending','paid','refunded')),
  total_cents integer not null check (total_cents >= 0),
  placed_at   timestamptz not null default now()
);
```

```sql
insert into customers (email, name) values
  ('ada@example.com',   'Ada Lovelace'),
  ('grace@example.com', 'Grace Hopper');
insert into orders (customer_id, status, total_cents) values
  (1, 'paid',    4200),
  (1, 'pending', 1500),
  (2, 'paid',    9900);
```

A test can now assert something exact:

```text
     name     | orders | cents
--------------+--------+-------
 Ada Lovelace |      2 |  5700
 Grace Hopper |      1 |  9900
(2 rows)
```

Three properties make that valuable, and none of them is available from a generator.

**It is deterministic.** Ada has two orders totalling 5,700 cents on every run, on every machine, forever. satus has no `--seed` flag, and its output is not deterministic between runs. That is a published limit of the v0.x series rather than a bug we are about to fix, and it means a test that asserts on a specific value has no business reading generated rows.

**It is reviewable.** A fixture change is a diff. A reviewer can see that the refund case was added and the pending order was removed. A generator's output is not in the repository at all.

**It needs nothing.** No API key, no network, no cost. `psql -f fixture.sql` runs in milliseconds and the failure modes are the ones you already understand.

## Where a fixture breaks

Fixtures encode the schema as it was on the day they were written. Here is a small migration of the kind that lands every week: a new required parent table, a required column on `customers` pointing at it, and a required `currency` on `orders`.

```sql
create table regions (
  id   integer generated always as identity primary key,
  code text not null unique
);
alter table customers add column region_id integer not null references regions(id);
alter table orders    add column currency  char(3) not null;
```

The same fixture, against the migrated schema:

```text
psql:fixture.sql:3: ERROR:  null value in column "region_id" of relation "customers" violates not-null constraint
DETAIL:  Failing row contains (1, ada@example.com, Ada Lovelace, null).
EXIT=3
```

It fails on the first statement. Fixing it means adding a `regions` row, threading a `region_id` through every customer, and adding a `currency` to every order, and then doing the same in every other fixture that touches those tables. On a two-table example that is a minute. On a real schema it is the reason fixtures rot: each migration adds a little work, nobody's ticket includes it, and within a year the fixture directory describes a database that no longer exists.

The failure is at least loud. The quieter version is a fixture that still loads because the new column has a default, and now every test row carries a default value that no real row ever would.

## What generation does with the same migration

Nothing was edited. This is the shipped CLI pointed at the migrated database, with no LLM key in the environment:

```text
satus generate
  schema:   public
  profile:  ecommerce
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   regions -> customers -> orders

  regions                          25 rows  ~$0.0018
  customers                        25 rows  ~$0.0036
  orders                           25 rows  ~$0.0054

  estimated cost: $0.0108

  simulating + validating...
  regions . (dry-run)
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 3 tables
EXIT=0
```

The new table is in the plan, in the right position, because the plan is a topological sort of the foreign keys read from `pg_catalog` at run time. The new columns are in the row schema because the columns were read at run time too. A migration that would have broken every fixture in the repository is, to the generator, the schema.

That run cost nothing and touched nothing. `--dry-run` reads the catalog, simulates the rows the model would produce, validates them against the live constraints, and exits. It does not need a provider key, which is why the transcript above shows a provider it could not have called. The `provider:` line is what the run *would* use; the [dry-run post](/blog/dry-run-validation) covers what the simulation does.

The same command against the same schema with one more constraint, `unique (currency)` on `orders`:

```text
  findings: 24 error / 0 warn
  error orders.currency                      unique_duplicate   x24  rows[1,2,3+]
         Duplicate value in UNIQUE column "currency" within the same batch
EXIT=2
```

Twenty-five orders drawn from a handful of three-letter currency codes will collide on that constraint; the simulation collides the same way, and the run says so before any money is spent. Exit code `2` is what a CI job keys on.

## What the dry run does and does not check

The validator has four finding classes: `not_null`, `fk_missing_parent`, `unique_duplicate`, and `length_overflow`. That list is in `packages/cli/src/generate/validate.ts`, and so is a note that `CHECK` constraints are planned and not yet introspected. The `status in ('pending','paid','refunded')` constraint on `orders` above is therefore invisible to the dry run. A real run would either satisfy it, because the profile steers the model toward plausible values, or fail the transaction and roll everything back. The dry run cannot tell you which.

Multi-column `UNIQUE` constraints are not enforced during generation either, and cross-column arithmetic is not reconciled: a `subtotal` and a `total` will not add up unless the model happens to make them. These are the v0.x limits, stated in the [README](https://github.com/PasskeyBridge-LLC/satus#readme) under "Honest limits" and on the [troubleshooting page](/docs/troubleshooting), and repeated here because a post about what generation is good at should carry what it is not.

## Where generation loses

**Determinism, again.** Two runs produce two different sets of rows. If a test needs to know what is in the table, generate cannot be the thing that put it there.

**It needs a provider for real rows.** The dry run is free; the run that writes needs an OpenAI or Anthropic key. You bring your own, and the spend is small. Our own [telemetry](/blog/cost-estimates-are-guardrails-not-accounting) puts three real 125-row runs at $0.000652 to $0.000669 each, against a dry-run estimate of $0.0207 that is deliberately conservative. Small is not zero, and a fixture is zero.

**It is only as good as the constraints.** A schema that says `text` where it means an email, and `integer` where it means cents, gives the generator less to work with than a schema that says so. Fixtures do not have this problem because a human typed the values. Generation inherits every ambiguity in the DDL.

## Using both

The working arrangement is that fixtures own the rows tests assert on and generation owns the volume around them, and the seam between the two has one rule the runner enforces.

In `satus.config.json`, `exclude` lists tables the run must not touch. That is the right place for a fixture-owned `plans` or `feature_flags` table. What it does not do is make the generator read the rows already in that table: parent values are drawn only from rows the run itself inserted. In `packages/cli/src/generate/runner.ts`, a generated row whose `NOT NULL` foreign key points at a table with no generated rows fails the run —

```text
No parent rows available for orders.customer_id -> customers.id. Check that customers is in the run set and not excluded.
```

— and a *nullable* foreign key into such a table is written as `NULL`. So a table can be fixture-owned and excluded when nothing generated points at it with a required key. When something does, the excluded table's rows are invisible to the run, and the honest choice is to let generation own that table as well.

`--truncate` respects the same boundary. It clears only the tables in the run set, and when a table outside the run set holds a foreign key into one being truncated it stops instead of cascading. The refusal, from `packages/cli/src/generate/writer.ts`, says why: "satus will not TRUNCATE ... CASCADE, because that would also empty a table you did not ask it to seed." That guard exists because through [0.3.6](/blog/v0-3-7-release-notes) the command cascaded into excluded tables, which is exactly the fixture-owned data this arrangement is meant to protect.

The last piece is the one the [troubleshooting page](/docs/troubleshooting) already recommends for the determinism gap: generate once, then capture the state with `pg_dump` or a database-branch snapshot and restore that between runs. The snapshot is a fixture in every sense above, reviewable and deterministic and free to load, and it was produced by the thing that keeps up with the schema. Regenerate it when the schema changes; hand-edit it never.

## The short version

Use a fixture when a test needs to name the row. Use generation when a test needs the database to be full of rows that obey the schema, and when the schema is going to change. Keep the first set small enough to maintain by hand, because that is the only way it stays maintained.

## Sources

- The fixture, migration, and dry-run transcripts above: PostgreSQL 16.13, `@passkeybridge/satus@0.3.11`, run 2026-09-25.
- Finding classes and the `CHECK` note: `packages/cli/src/generate/validate.ts`.
- `--truncate` scope and the refusal to cascade: `packages/cli/src/generate/writer.ts`.
- `exclude`: `packages/cli/src/generate/config.ts`.
- Measured run costs: [Cost estimates are guardrails, not accounting](/blog/cost-estimates-are-guardrails-not-accounting).
- Earlier on the same question: [When faker.js is exactly the wrong answer](/blog/when-faker-is-the-wrong-answer).
