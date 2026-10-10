---
slug: relational-integrity-is-table-stakes
title: Relational integrity is table stakes; arithmetic integrity is not
description: satus 0.3.11 checks foreign keys, types and NOT NULL. It does not check totals or CHECK constraints. What the dry run sees, and what Postgres enforces.
date: 2026-10-23
publishAt: 2026-10-23T09:00:00-04:00
author: satus.sh
tags: [seeding, postgres, constraints, generated-columns]
draft: true
---

A seeded order whose `total_cents` is not `subtotal_cents + tax_cents` passes every check `@passkeybridge/satus@0.3.11` runs before a write. Foreign keys resolve, types match, `NOT NULL` holds. The arithmetic is not checked, and the [README](https://github.com/PasskeyBridge-LLC/satus#readme) lists that under "Honest limits (v0.x)": "cross-column arithmetic is not reconciled". This post shows where that line sits in the shipped CLI, what Postgres can and cannot enforce on its own, and how to move the arithmetic into the schema so a generated row cannot get it wrong. Every transcript below ran on PostgreSQL 17.11 with `psql` 17.11, against `@passkeybridge/satus@0.3.11`, with no provider key in the environment.

## The schema

Two tables, the shape most order schemas have. The order carries its own subtotal, tax and total, and a shipping date that has to come after the order date.

```sql
create table orders (
  id             integer generated always as identity primary key,
  subtotal_cents integer not null,
  tax_cents      integer not null,
  total_cents    integer not null,
  placed_at      timestamptz not null,
  shipped_at     timestamptz,
  constraint total_adds_up check (total_cents = subtotal_cents + tax_cents),
  constraint ships_after_placed check (shipped_at is null or shipped_at >= placed_at)
);

create table order_items (
  id               integer generated always as identity primary key,
  order_id         integer not null references orders(id),
  quantity         integer not null,
  unit_price_cents integer not null,
  line_total_cents integer not null
);
```

There are three sums in this schema. `total_adds_up` is the only one Postgres knows about. `line_total_cents = quantity * unit_price_cents` is not declared anywhere, and `subtotal_cents` matching the sum of an order's line items cannot be declared as a `CHECK` at all:

```
$ psql $DATABASE_URL -c "alter table orders add constraint subtotal_matches_items check (subtotal_cents = (select sum(line_total_cents) from order_items where order_id = orders.id))"
ERROR:  cannot use subquery in check constraint
```

A `CHECK` constraint sees one row. A rule that spans rows lives in a trigger, in application code, or nowhere. The introspection query in [`introspect.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/introspect.ts) reads primary keys, foreign keys and single-column unique constraints from `pg_constraint`, and does not read triggers, so satus never hears about a rule kept there.

## What the dry run checks

The dry run reads the catalog, simulates rows, and validates them. It needs no key and writes nothing:

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   orders -> order_items

  orders                           25 rows  ~$0.0054
  order_items                      25 rows  ~$0.0045

  estimated cost: $0.0099

  simulating + validating...
  orders . (dry-run)
  order_items . (dry-run)

  ✓ no validation findings across 2 tables
```

The coverage list at the top of [`validate.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/validate.ts) is short: `NOT NULL`, type mismatches, integer range, string length, UUID shape, foreign keys present in the parent pool, and single-column `UNIQUE` within a batch. The same comment lists `CHECK` constraints as out of scope for v0.3.x. That is easy to confirm. Add a constraint no row can satisfy and run the dry run again:

```
$ psql $DATABASE_URL -c "alter table order_items add constraint impossible check (quantity > 0 and quantity < 0)"
ALTER TABLE
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   orders -> order_items

  orders                           25 rows  ~$0.0054
  order_items                      25 rows  ~$0.0045

  estimated cost: $0.0099

  simulating + validating...
  orders . (dry-run)
  order_items . (dry-run)

  ✓ no validation findings across 2 tables
```

A clean dry run says the relational plan is sound. It says nothing about `total_adds_up`, `ships_after_placed`, or a constraint that rejects every row. Postgres still enforces those on insert during a real run, and the run is one transaction, so a violation rolls the whole run back. The environment these transcripts come from has no provider key, so this post contains no output from a real run.

## Move the arithmetic into the schema

The rows satus asks a model for exclude generated columns, identity columns, defaulted columns and foreign keys; the filter is in [`schema.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/schema.ts). A total the database computes is a total the model never writes. Two of the three sums can be generated columns:

```sql
create table orders (
  id             integer generated always as identity primary key,
  subtotal_cents integer not null default 0,
  tax_cents      integer not null default 0,
  total_cents    integer generated always as (subtotal_cents + tax_cents) stored,
  placed_at      timestamptz not null,
  shipped_at     timestamptz,
  constraint ships_after_placed check (shipped_at is null or shipped_at >= placed_at)
);

create table order_items (
  id               integer generated always as identity primary key,
  order_id         integer not null references orders(id),
  quantity         integer not null,
  unit_price_cents integer not null,
  line_total_cents integer generated always as (quantity * unit_price_cents) stored
);
```

`subtotal_cents` and `tax_cents` now default to `0`, which also takes them out of the model's row schema. The dry run against this version is clean:

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   orders -> order_items

  orders                           25 rows  ~$0.0054
  order_items                      25 rows  ~$0.0045

  estimated cost: $0.0099

  simulating + validating...
  orders . (dry-run)
  order_items . (dry-run)

  ✓ no validation findings across 2 tables
```

The per-table estimates did not move. The estimate in [`runner.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/runner.ts) is a heuristic over every column in the table, generated or not, so it stays pessimistic here.

A generated column also cannot be overwritten later, by a seed or by anyone else:

```
$ psql $DATABASE_URL -c "update orders set total_cents = 1 where id = 1"
ERROR:  column "total_cents" can only be updated to DEFAULT
DETAIL:  Column "total_cents" is a generated column.
```

This is a schema change, and it is only right if the application never needs to store a total that differs from the arithmetic, for example a historical order priced under an old tax rate. Where that is true, the generated column is the stronger rule for production as well as for seeds.

## The cross-row sum, after the seed

The subtotal is the sum of other rows, which a generated column cannot express. It can be derived after the seed, inside the same script that runs it. The rows below were inserted with plain SQL and `generate_series`, standing in for a real `satus generate` run:

```sql
insert into orders (placed_at)
select timestamptz '2026-10-01 12:00+00' + g * interval '1 hour'
from generate_series(1, 3) g;

insert into order_items (order_id, quantity, unit_price_cents)
select o.id, i, 250 * o.id
from orders o, generate_series(1, 2) i;
```

```
$ psql $DATABASE_URL -c "select id, subtotal_cents, tax_cents, total_cents from orders order by id"
 id | subtotal_cents | tax_cents | total_cents 
----+----------------+-----------+-------------
  1 |              0 |         0 |           0
  2 |              0 |         0 |           0
  3 |              0 |         0 |           0
(3 rows)
```

One `UPDATE` rolls the line items up. The 8% tax rate is an example value:

```sql
update orders o
set subtotal_cents = s.sum_cents,
    tax_cents      = round(s.sum_cents * 0.08)
from (
  select order_id, sum(line_total_cents) as sum_cents
  from order_items
  group by order_id
) s
where s.order_id = o.id;
```

```
$ psql $DATABASE_URL -f rollup.sql
UPDATE 3
$ psql $DATABASE_URL -c "select id, subtotal_cents, tax_cents, total_cents from orders order by id"
 id | subtotal_cents | tax_cents | total_cents 
----+----------------+-----------+-------------
  1 |            750 |        60 |         810
  2 |           1500 |       120 |        1620
  3 |           2250 |       180 |        2430
(3 rows)
```

`total_cents` followed on its own. A query that returns zero rows when every subtotal matches its items is cheap to keep in CI after the rollup:

```sql
select o.id, o.subtotal_cents, sum(i.line_total_cents) as items_cents
from orders o
join order_items i on i.order_id = o.id
group by o.id, o.subtotal_cents
having o.subtotal_cents <> sum(i.line_total_cents);
```

```
$ psql $DATABASE_URL -f drift.sql
 id | subtotal_cents | items_cents 
----+----------------+-------------
(0 rows)
```

## Sequencing is a CHECK, and Postgres holds it

`ships_after_placed` is a single-row rule, so Postgres rejects a violation on insert whatever wrote the row:

```
$ psql $DATABASE_URL -c "insert into orders (placed_at, shipped_at) values ('2026-10-02 12:00+00', '2026-10-01 12:00+00')"
ERROR:  new row for relation "orders" violates check constraint "ships_after_placed"
DETAIL:  Failing row contains (4, 0, 0, 0, 2026-10-02 08:00:00-04, 2026-10-01 08:00:00-04).
```

The timestamps in the error are shown in the session time zone, `America/New_York` here. In a real satus run, the same rejection rolls back the whole transaction. The dry run does not read `CHECK` constraints, so it does not predict that rejection.

## What satus would need to change

Cross-column consistency is item 1 of Phase 2 in the [roadmap](https://github.com/PasskeyBridge-LLC/satus/blob/main/docs/ROADMAP.md), and `CHECK` introspection is marked as planned in the `validate.ts` comment. Neither is in 0.3.11. Until one ships, the arithmetic belongs in the schema where it can be generated, and in a rollup script where it spans rows.

Run the dry run against your own schema first. It needs no key and writes nothing, and the [quickstart](/quickstart) has the install line.

## Sources

- Every transcript above: PostgreSQL 17.11 (Debian 17.11-0+deb13u1), `psql` 17.11, `@passkeybridge/satus@0.3.11` on Node 20.19.2, run 2026-10-09 with no provider key set. The rows in the rollup section were inserted with plain SQL, not by a real `satus generate` run.
- Validator coverage and the planned `CHECK` introspection: the header comment of [`packages/cli/src/generate/validate.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/validate.ts).
- Which columns the model is asked for: [`packages/cli/src/generate/schema.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/schema.ts).
- Single-row `CHECK` constraints and generated columns: the PostgreSQL 17 docs on [constraints](https://www.postgresql.org/docs/17/ddl-constraints.html) and [generated columns](https://www.postgresql.org/docs/17/ddl-generated-columns.html).
- The v0.x limits: the [README](https://github.com/PasskeyBridge-LLC/satus#readme). Phase 2 scope: the [roadmap](https://github.com/PasskeyBridge-LLC/satus/blob/main/docs/ROADMAP.md).
