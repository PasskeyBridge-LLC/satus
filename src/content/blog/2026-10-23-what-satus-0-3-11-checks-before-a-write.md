---
slug: what-satus-0-3-11-checks-before-a-write
title: What the satus 0.3.11 dry run checks, and how Postgres computes order totals
seoTitle: What the satus 0.3.11 dry run checks
description: The satus 0.3.11 dry run checks foreign keys, types, and NOT NULL. It does not check order totals. Postgres enforces CHECKs and generated columns on insert.
date: 2026-10-23
publishAt: 2026-10-23T09:00:00-04:00
author: satus.sh
tags: [seeding, postgres, constraints, generated-columns]
draft: false
---

The dry run validates simulated rows. A real run sends generated rows to Postgres, which enforces its constraints on insert. A seeded order whose `total_cents` is not `subtotal_cents + tax_cents` can still pass the dry-run validator when the row satisfies the checks that validator actually runs. The dry-run validator does not check this arithmetic relationship. Foreign keys, types, and `NOT NULL` are separate checks. The [README at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/README.md) lists the arithmetic gap under "Honest limits (v0.x)": "cross-column arithmetic is not reconciled".

`@passkeybridge/satus@0.3.12` is the current npm release. The checks below are the ones in the v0.3.11 source linked at the end. The transcripts were re-run on 2026-11-06 with `@passkeybridge/satus@0.3.12` against PostgreSQL 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), `psql` 17.11, and Node v24.21.0, with no provider key. `DATABASE_URL` is `postgresql://postgres:postgres@127.0.0.1:5433/check_dev`. The session time zone for the inserts below is `UTC`.

## The schema

Two tables: orders and their line items. The order carries its own subtotal, tax, and total, and a shipping date that has to come after the order date.

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

There are three sums in this schema. `total_adds_up` is the only one Postgres knows about. `line_total_cents = quantity * unit_price_cents` is not declared anywhere. A subquery in a `CHECK` is rejected:

```sql
alter table orders add constraint subtotal_matches_items check (
  subtotal_cents = (select sum(line_total_cents) from order_items where order_id = orders.id)
);
```

```
ERROR:  cannot use subquery in check constraint
```

Postgres rejects a subquery directly in a `CHECK` and does not support `CHECK` as a cross-row consistency rule. A rule that spans rows has to be a trigger or application code, or it is not enforced. The introspection query in [`introspect.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/introspect.ts) reads primary keys, foreign keys, and single-column unique constraints from `pg_constraint`. It does not read triggers, so satus does not see a rule that a trigger enforces.

## What the dry run checks

The dry run reads the catalog, simulates rows, and validates them. It needs no key and writes nothing. `runner.ts` calls the validator on the dry-run path. The real path inserts and lets Postgres accept or reject the row.

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

The coverage list at the top of [`validate.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/validate.ts) names `NOT NULL`, type mismatches, integer range, string length, UUID shape, foreign keys present in the parent pool, and single-column `UNIQUE` within a batch. The same comment lists `CHECK` constraints as out of scope for v0.3.x. A constraint no row can satisfy does not change the dry run:

```sql
alter table order_items add constraint impossible check (quantity > 0 and quantity < 0);
```

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

A clean dry run means those listed checks found no problems. It does not check `total_adds_up`, `ships_after_placed`, or a constraint that rejects every row. Postgres still enforces those on insert during a real run. The run is one transaction, so a violation rolls the table changes back. Sequence values allocated by ordinary inserts can remain consumed. This environment had no provider key, so there is no output from a real `satus generate` run.

## Move the arithmetic into the schema

The rows satus asks a model for exclude generated columns, identity columns, defaulted columns, and foreign keys. The filter is in [`schema.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/schema.ts). The model is not asked for a column that the database computes. Drop the first pair of tables, then create the generated-column version:

```sql
drop table order_items;
drop table orders;

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

`subtotal_cents` and `tax_cents` now default to `0`, which also removes them from the model's row schema. The dry run against this version is clean, and the per-table estimates are the same numbers as before:

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

The estimate in [`runner.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/runner.ts) is a heuristic over every column in the table, generated or not, so here it also counts the columns the model is not asked for.

A generated column cannot be set to a value other than `DEFAULT`:

```sql
update orders set total_cents = 1 where id = 1;
```

```
ERROR:  column "total_cents" can only be updated to DEFAULT
DETAIL:  Column "total_cents" is a generated column.
```

A generated `total_cents` cannot store a manual adjustment that is not already in `subtotal_cents` or `tax_cents`. An old tax rate can still be stored in `tax_cents`. If the application needs a total that is neither input column, keep `total_cents` as a normal column.

## The cross-row sum, after the seed

The subtotal is the sum of other rows, which a generated column cannot express. The rows below were inserted with plain SQL, in place of a real `satus generate` run:

```sql
insert into orders (placed_at)
select timestamptz '2026-10-01 12:00+00' + g * interval '1 hour'
from generate_series(1, 3) g;

insert into order_items (order_id, quantity, unit_price_cents)
select o.id, i, 250 * o.id
from orders o, generate_series(1, 2) i;
```

```
 id | subtotal_cents | tax_cents | total_cents 
----+----------------+-----------+-------------
  1 |              0 |         0 |           0
  2 |              0 |         0 |           0
  3 |              0 |         0 |           0
(3 rows)
```

One `UPDATE` sets each order's subtotal and tax from its line items. The 8% figure is an example rate:

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
 id | subtotal_cents | tax_cents | total_cents 
----+----------------+-----------+-------------
  1 |            750 |        60 |         810
  2 |           1500 |       120 |        1620
  3 |           2250 |       180 |        2430
(3 rows)
```

Postgres recomputed `total_cents` from the new subtotal and tax. An inner join does not see an order that has no items. This query uses `LEFT JOIN`, `coalesce`, and `IS DISTINCT FROM`. On orders 1 through 3 it returns no rows:

```sql
select o.id,
       o.subtotal_cents,
       coalesce(sum(i.line_total_cents), 0) as items_cents
from orders o
left join order_items i on i.order_id = o.id
where o.id <= 3
group by o.id, o.subtotal_cents
having o.subtotal_cents is distinct from coalesce(sum(i.line_total_cents), 0)
order by o.id;
```

```
 id | subtotal_cents | items_cents 
----+----------------+-------------
(0 rows)
```

An order with subtotal 100 and no line items, and another whose subtotal was set to 1 with no line items, both show up:

```
 id | subtotal_cents | items_cents 
----+----------------+-------------
  4 |            100 |           0
  5 |              1 |           0
(2 rows)
```

## Postgres enforces the shipping-date CHECK on insert

`ships_after_placed` is a single-row rule, so Postgres rejects a violation on insert:

```sql
insert into orders (placed_at, shipped_at)
values (timestamptz '2026-10-02 12:00+00', timestamptz '2026-10-01 12:00+00');
```

```
ERROR:  new row for relation "orders" violates check constraint "ships_after_placed"
DETAIL:  Failing row contains (6, 0, 0, 0, 2026-10-02 12:00:00+00, 2026-10-01 12:00:00+00).
```

The timestamps are in the session time zone, `UTC` here. In a real satus run, the same rejection rolls back the transaction's table changes. The dry run does not read `CHECK` constraints, so it does not predict that rejection.

## What satus would need to change

Cross-column consistency is item 1 of Phase 2 in the [roadmap](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/docs/ROADMAP.md), and `CHECK` introspection is marked as planned in the `validate.ts` comment. Neither is in 0.3.11, and the 0.3.12 dry run above still exits 0 with the impossible `CHECK` in place. Until one ships, compute the arithmetic in the schema with generated columns where the total is the sum of columns on the same row, and in a rollup script where it spans rows.

Run the dry run against your own schema first. It needs no key and writes nothing, and the [quickstart](/quickstart) has the install line.

## Sources

- Every transcript above: PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2), `psql` 17.11, `@passkeybridge/satus@0.3.12` on Node v24.21.0, run 2026-11-06 with no provider key set. The rows in the rollup section were inserted with plain SQL, not by a real `satus generate` run.
- Validator coverage and the planned `CHECK` introspection: the header comment of [`packages/cli/src/generate/validate.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/validate.ts).
- Which columns the model is asked for: [`packages/cli/src/generate/schema.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/schema.ts).
- Single-row `CHECK` constraints and generated columns: the PostgreSQL 17 docs on [constraints](https://www.postgresql.org/docs/17/ddl-constraints.html) and [generated columns](https://www.postgresql.org/docs/17/ddl-generated-columns.html).
- The v0.x limits: the [README at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/README.md). Phase 2 scope: the [roadmap at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/docs/ROADMAP.md).

Source-visible and commercially licensed. Not open source. See `LICENSE`.
