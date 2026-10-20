---
slug: how-satus-decides-a-database-is-too-full-to-seed
title: How satus 0.3.11 decides a database is too full to seed
description: Before any write, satus 0.3.11 counts rows in every user table in the database and refuses above 10,000 with exit 11. What it counts, what it skips, and why.
date: 2026-11-06
publishAt: 2026-11-06T09:00:00-05:00
author: satus.sh
tags: [seeding, postgres, safety, ci]
draft: false
---

`satus generate` writes rows into the database `DATABASE_URL` points at. Before it introspects the schema or calls a model, `@passkeybridge/satus@0.3.11` counts the rows already in that database, and if there are more than 10,000 it refuses to run and exits `11`. The guard exists to catch a `DATABASE_URL` that points at production. This post shows what the guard counts, what it does not count, and how it behaves under a dry run, `--schema`, `--force` and a restricted role. Every transcript below ran on PostgreSQL 17.11 with `psql` 17.11, against `@passkeybridge/satus@0.3.11`.

## The rule

The code is in [`guard.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/guard.ts). It lists every table with `relkind = 'r'` outside `pg_catalog`, `information_schema` and the `pg_toast` and `pg_temp` schemas, keeps the ones the connected role has `SELECT` on, and counts rows in chunks of 100 tables. Each table is counted through a subquery with `limit 10001`, so no single table costs more than 10,001 rows of reading, and the loop stops as soon as the running total passes 10,000.

It counts real rows. The comment in the source gives the reason for not using `pg_class.reltuples`: the planner estimate is stale between `ANALYZE` runs and is `-1` for a table that has never been analyzed, which is the state of a freshly restored production dump.

## The schema

Two tables to seed in `public`, and one table in a separate `audit` schema that already holds data:

```sql
create table customers (
  id    integer generated always as identity primary key,
  email text not null unique
);

create table orders (
  id          integer generated always as identity primary key,
  customer_id integer not null references customers(id),
  total_cents integer not null
);

create schema audit;

create table audit.events (
  id      bigint generated always as identity primary key,
  payload text not null
);
```

```sql
insert into audit.events (payload)
select 'event ' || g from generate_series(1, 10000) g;
```

## 10,000 rows passes, 10,001 does not

With exactly 10,000 rows in `audit.events`, a dry run plans and validates as usual:

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0018
  orders                           25 rows  ~$0.0027

  estimated cost: $0.0045

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

The limit is "more than 10,000". One more row:

```sql
insert into audit.events (payload) values ('event 10001');
```

The dry run now prints a warning on its first line and carries on. It still exits `0`, because a dry run writes nothing:

```
$ satus generate --dry-run --rows 25
  ! this database holds more than 10,000 rows; a real run would be refused (exit 11). Use --force to override.

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0018
  orders                           25 rows  ~$0.0027

  estimated cost: $0.0045

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

A real run refuses. It needs a provider key to get as far as the guard, because a missing key is checked first and exits `1`. Here the key is the string `placeholder`: the guard runs before any provider call, so the key is never sent anywhere.

```
$ OPENAI_API_KEY=placeholder satus generate --rows 25
Refusing to run: this database already holds more than 10,000 rows across 3 user table(s).
  satus generate writes rows, and a database this full is usually not the one you meant
  to seed. Check DATABASE_URL.
  If it is the right database — a staging environment with real fixtures, say — re-run
  with --force.
```

The exit code is `11`. Nothing was written:

```
$ psql $DATABASE_URL -f count.sql
 audit_events | customers | orders 
--------------+-----------+--------
        10001 |         0 |      0
(1 row)
```

The message counts three user tables, which includes `audit.events`. The run was asked to seed `public`, and the rows that tripped the guard are in a different schema.

## `--schema` does not narrow the count

`--schema` picks the tables to seed. It does not change what the guard counts:

```
$ satus generate --dry-run --rows 25 --schema audit
  ! this database holds more than 10,000 rows; a real run would be refused (exit 11). Use --force to override.

satus generate
  schema:   audit
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   events

  events                           25 rows  ~$0.0018

  estimated cost: $0.0018

  simulating + validating...
  events . (dry-run)

  ✓ no validation findings across 1 tables
```

The guard asks whether the database looks like one you meant to seed. A production database with an empty `staging` schema still holds production data, so the count covers every schema.

## Materialized views, views and partitioned parents are not counted

Back at 10,000 rows, with a materialized view holding twice that:

```
$ psql $DATABASE_URL -f matview.sql
SELECT 20000
   relname   | relkind | rows  
-------------+---------+-------
 events_copy | m       | 20000
(1 row)
```

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0018
  orders                           25 rows  ~$0.0027

  estimated cost: $0.0045

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

No warning. A materialized view has `relkind = 'm'`, so its 20,000 rows are not counted. Views (`'v'`) hold no rows of their own. Partitions are ordinary tables (`'r'`) and are counted; their partitioned parent (`'p'`) is not, so a partitioned table's rows are counted once. Foreign tables (`'f'`) are skipped so that the guard does not query another server.

## A role that cannot read a table

The guard only counts tables the role can read. A seeding role with privileges on `public` and none on `audit`:

```sql
create role seeder login password 'seeder';
grant usage on schema public to seeder;
grant select, insert, update, delete on all tables in schema public to seeder;
```

`audit.events` is back at 10,001 rows. As `seeder`, with no `USAGE` on the `audit` schema, the run does not reach the count:

```
$ satus generate --dry-run --rows 25 --dsn postgresql://seeder:seeder@localhost/shop_dev
error: permission denied for schema audit
```

The guard casts each table name to `regclass` to pass it to `has_table_privilege`, and that cast fails for a table in a schema the role has no `USAGE` on. In 0.3.11 the run exits `1` in this case. With `USAGE` on the schema and still no `SELECT` on the table:

```
$ psql -q $DATABASE_URL -c "grant usage on schema audit to seeder"
```

```
$ satus generate --dry-run --rows 25 --dsn postgresql://seeder:seeder@localhost/shop_dev

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0018
  orders                           25 rows  ~$0.0027

  estimated cost: $0.0045

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

The guard skips `audit.events`, counts zero rows in `public`, and passes. A role that can read everything trips the guard; a role that can read only the tables it seeds does not. The source states the reasoning: "A role that cannot read a table also cannot be seeding it." When a guard trip does include skipped tables, the refusal message reports how many were skipped for lack of `SELECT` privilege.

## `--force`

`--force` skips the count entirely. The dry run prints no warning:

```
$ satus generate --dry-run --rows 25 --force

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0018
  orders                           25 rows  ~$0.0027

  estimated cost: $0.0045

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

Use it for a database you know holds real fixtures, such as a staging copy. In CI, exit `11` is distinct from exit `1`, so a pipeline can tell "satus declined to run" from "satus tried and failed".

## What the guard does not do

It is not a permission check, and it does not undo anything; the source says so in its header. Rollback is the job of the single transaction every real run uses: a failed run leaves the database as it was. The guard runs before that transaction begins.

The other published v0.x limits still apply to any run that passes the guard: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
