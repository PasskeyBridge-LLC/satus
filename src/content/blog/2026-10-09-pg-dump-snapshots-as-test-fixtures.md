---
slug: pg-dump-snapshots-as-test-fixtures
title: pg_dump snapshots as test fixtures
description: Generate once, dump the rows, restore them between test runs. The commands, two pg_dump defaults that make a fixture churn, and a restore that half-loads.
date: 2026-10-09
publishAt: 2026-10-09T09:00:00-04:00
author: satus.sh
tags: [seeding, testing, fixtures, postgres, pg_dump]
draft: false
---

The [troubleshooting page](/docs/troubleshooting) and [the fixtures-vs-generation post](/blog/fixtures-vs-generation-when-each-wins) give the same answer to the determinism gap: generate once, capture the result with `pg_dump`, and restore that between runs. Neither shows the commands. This post does, along with three places where the obvious commands produce a fixture that changes when nothing changed or a restore that stops halfway. Every transcript below ran on PostgreSQL 17.11, with `pg_dump` and `psql` 17.11, against the shipped `@passkeybridge/satus@0.3.11`.

## The schema, and a dry run before anything is written

The schema is the migrated one from that post: a `regions` table, a required `region_id` on `customers`, and a required `currency` on `orders`.

```sql
create table regions (
  id   integer generated always as identity primary key,
  code text not null unique
);
create table customers (
  id        integer generated always as identity primary key,
  email     text not null unique,
  name      text not null,
  region_id integer not null references regions(id)
);
create table orders (
  id          integer generated always as identity primary key,
  customer_id integer not null references customers(id),
  status      text not null check (status in ('pending','paid','refunded')),
  total_cents integer not null check (total_cents >= 0),
  currency    char(3) not null,
  placed_at   timestamptz not null default now()
);
```

Before anything is written, the dry run reads the catalog, simulates the rows, and validates them against the live constraints. It needs no provider key:

```text
$ DATABASE_URL=postgresql://postgres@localhost/app_dev satus generate --dry-run --profile ecommerce --rows 25

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

The fixtures-vs-generation post covers what the validator checks and what it does not, including the `CHECK` constraint on `status`, which the dry run cannot see.

## The seeding step, and what stood in for it here

The write step is the same command without `--dry-run`, with an `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the environment. The environment these transcripts come from has no provider key, so this post contains no output from a real run. The rows in `app_dev` were inserted with plain SQL and `generate_series` instead:

```text
$ psql -X -d app_dev -c "select (select count(*) from regions) as regions, (select count(*) from customers) as customers, (select count(*) from orders) as orders"
 regions | customers | orders 
---------+-----------+--------
       3 |        25 |     25
(1 row)
```

Everything after this point operates on whatever rows are in the database, and none of it depends on how they got there. The write step is also the only nondeterministic one. satus has no `--seed` flag, so two real runs produce two different sets of rows; that is a published v0.x limit. The dump is where the repeatability comes from.

## Dump the rows, not the schema

The dump is `pg_dump --data-only -d app_dev -f fixture-a.sql`. `--data-only` leaves out every `CREATE TABLE`. The schema already has an owner, which is the migrations directory. A fixture that carried its own table definitions would restore without complaint into a database whose migrations had moved on. A data-only fixture restores into the schema the migrations built and fails when the two disagree, which is the behaviour a test suite wants.

The file holds one `COPY` per table, in foreign-key order, and one `setval` per identity sequence:

```text
$ grep -n -E "^(COPY|SELECT pg_catalog.setval)" fixture-a.sql
26:COPY public.regions (id, code) FROM stdin;
37:COPY public.customers (id, email, name, region_id) FROM stdin;
70:COPY public.orders (id, customer_id, status, total_cents, currency, placed_at) FROM stdin;
103:SELECT pg_catalog.setval('public.customers_id_seq', 25, true);
110:SELECT pg_catalog.setval('public.orders_id_seq', 25, true);
117:SELECT pg_catalog.setval('public.regions_id_seq', 3, true);
```

The `setval` lines carry the sequence positions, so a test that inserts a row after the restore gets the next id after the fixture rather than a collision with it. That is shown below.

## Two dumps of an unchanged database differ

Run the same dump twice against the same database and compare the files:

```text
$ pg_dump --data-only -d app_dev -f fixture-a.sql && pg_dump --data-only -d app_dev -f fixture-b.sql && diff fixture-a.sql fixture-b.sql
5c5
< \restrict euPveE0jgb1LpzdWvFyyX54EqidEtnmZSAeFQ7WAsIKGXd2ghpQ1D1GR0p6C6Ha
---
> \restrict eaqerTuWMX0S4FabvApk2RXrh0KkpblUrIrhJUorZIctlW8ieiva8dZQlEsqU30
124c124
< \unrestrict euPveE0jgb1LpzdWvFyyX54EqidEtnmZSAeFQ7WAsIKGXd2ghpQ1D1GR0p6C6Ha
---
> \unrestrict eaqerTuWMX0S4FabvApk2RXrh0KkpblUrIrhJUorZIctlW8ieiva8dZQlEsqU30
EXIT=1
```

Since 17.6, released 2025-08-14, `pg_dump` wraps plain-text output in a psql `\restrict` command with a random key, so text coming from the dumped server cannot be read back as psql meta-commands during the restore. The [release notes](https://www.postgresql.org/docs/release/17.6/) list it under CVE-2025-8714. A fresh key on every run means a regenerated fixture shows a two-line diff when no row changed, and a checksum of the file never matches twice.

`--restrict-key` pins the key:

```text
$ pg_dump --data-only --restrict-key=satusfixture -d app_dev -f fixture.sql && pg_dump --data-only --restrict-key=satusfixture -d app_dev -f fixture-again.sql && sha256sum fixture.sql fixture-again.sql
778e9255bd72e66be761a5803da3051486a7439f96edd83707a854d36d0c5b5b  fixture.sql
778e9255bd72e66be761a5803da3051486a7439f96edd83707a854d36d0c5b5b  fixture-again.sql
EXIT=0
```

The [`pg_dump` reference](https://www.postgresql.org/docs/17/app-pgdump.html) says the option "is primarily intended for testing purposes and other scenarios that require repeatable output (e.g., comparing dump files)", and warns against general use because "a malicious server with advance knowledge of the key may be able to inject arbitrary code". A fixture dumped from a local database that your own seed run populated is the case the option was written for. A dump from a server you do not control should keep the random key.

## The time zone is part of the file

The second source of churn is quieter. `timestamptz` values are written in the time zone of the session doing the dump. This server runs in `America/New_York`. The same database, dumped with `PGTZ=UTC` and compared to the fixture:

```text
$ PGTZ=UTC pg_dump --data-only --restrict-key=satusfixture -d app_dev | diff fixture.sql - | head -4
71,95c71,95
< 1	2	paid	500	USD	2026-09-01 09:00:00-04
< 2	3	refunded	1000	INR	2026-09-01 10:00:00-04
< 3	4	pending	1500	EUR	2026-09-01 11:00:00-04
EXIT=0
```

Lines 71 to 95 are all 25 `orders` rows. Every instant is unchanged; 09:00 at `-04` is 13:00 at `+00`. Only the text differs, and the text is what a diff and a checksum see. A fixture regenerated by someone whose session runs in another zone rewrites every timestamp column in the file. Setting the zone in the dump command removes the dependency on who ran it:

```text
$ PGTZ=UTC pg_dump --data-only --restrict-key=satusfixture -d app_dev -f fixture-utc.sql && grep -A1 "^COPY public.orders" fixture-utc.sql && sha256sum fixture-utc.sql
COPY public.orders (id, customer_id, status, total_cents, currency, placed_at) FROM stdin;
1	2	paid	500	USD	2026-09-01 13:00:00+00
786d1f4ca7ba345a23ca8e44046f7ac18f62c39f05846bed0d1e9d707d52cefa  fixture-utc.sql
EXIT=0
```

That is the dump command worth putting in a script.

## Restore into a migrated database, in one transaction

The restore builds the schema the way the test database is always built, from the migrations, and then loads the rows:

```text
$ createdb app_test && psql -X -q -d app_test -f schema.sql && psql -X -q -1 -v ON_ERROR_STOP=1 -o /dev/null -d app_test -f fixture.sql
EXIT=0
```

`-X` skips `~/.psqlrc`, as the `pg_dump` reference recommends for restores. `-1` wraps the whole file in one transaction. `ON_ERROR_STOP=1` stops at the first error and makes `psql` exit non-zero. `-o /dev/null` discards the result rows that the `set_config` and `setval` calls in the file print.

Dumped again with the same key, the restored database produces the fixture's checksum:

```text
$ pg_dump --data-only --restrict-key=satusfixture -d app_test | sha256sum
778e9255bd72e66be761a5803da3051486a7439f96edd83707a854d36d0c5b5b  -
EXIT=0
```

And the next insert continues after the fixture's 25 orders:

```text
$ psql -X -d app_test -c "insert into orders (customer_id, status, total_cents, currency) values (1, 'paid', 100, 'EUR') returning id"
 id 
----
 26
(1 row)

INSERT 0 1
```

## When the migrations move, the fixture fails

The next migration adds `phone text not null` to `customers`. The same restore, into a database built with that migration:

```text
$ psql -X -q -1 -v ON_ERROR_STOP=1 -o /dev/null -d app_ci -f fixture.sql
psql:fixture.sql:63: ERROR:  null value in column "phone" of relation "customers" violates not-null constraint
DETAIL:  Failing row contains (1, user1@example.com, Customer 1, 2, null).
CONTEXT:  COPY customers, line 1: "1	user1@example.com	Customer 1	2"
EXIT=3

$ psql -X -At -d app_ci -c "select count(*) from regions"
0
```

Exit `3` stops the CI job, and the database is left empty. Without `-1`, the failure is the same and the exit code is the same, but each `COPY` commits on its own, so the `regions` rows loaded before the `customers` error stay behind:

```text
$ psql -X -q -v ON_ERROR_STOP=1 -o /dev/null -d app_ci -f fixture.sql
psql:fixture.sql:63: ERROR:  null value in column "phone" of relation "customers" violates not-null constraint
DETAIL:  Failing row contains (1, user1@example.com, Customer 1, 2, null).
CONTEXT:  COPY customers, line 1: "1	user1@example.com	Customer 1	2"
EXIT=3

$ psql -X -At -d app_ci -c "select count(*) from regions"
3
```

A script that ignores the exit code runs the suite against a database with regions and no customers. If the new column had a default, the restore would succeed and every customer would carry that default; the fixtures-vs-generation post covers that quieter failure.

The failed restore is the signal to regenerate. The dry run against the migrated schema passes, and the `customers` estimate has moved because the row schema gained a column:

```text
$ DATABASE_URL=postgresql://postgres@localhost/app_ci satus generate --dry-run --profile ecommerce --rows 25

satus generate
  schema:   public
  profile:  ecommerce
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   regions -> customers -> orders

  regions                          25 rows  ~$0.0018
  customers                        25 rows  ~$0.0045
  orders                           25 rows  ~$0.0054

  estimated cost: $0.0117

  simulating + validating...
  regions . (dry-run)
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 3 tables
EXIT=0
```

From there the loop is the one above: run the write step against a freshly migrated database, dump with the pinned key and `PGTZ=UTC`, and review the diff before committing it.

## One restore, many test databases

Replaying the file once per suite works. The alternative is to restore it once and clone the result, since `createdb -T` copies an existing database with its rows and sequence positions:

```text
$ createdb -T app_dev app_test_run1 && psql -X -At -d app_test_run1 -c "select count(*) from orders"
25
EXIT=0
```

The source has to be idle. With a second `psql` session still connected to `app_dev`:

```text
$ createdb -T app_dev app_test_run1
createdb: error: database creation failed: ERROR:  source database "app_dev" is being accessed by other users
DETAIL:  There is 1 other session using the database.
EXIT=1
```

The [`CREATE DATABASE` reference](https://www.postgresql.org/docs/17/sql-createdatabase.html) states the same limit: "no other sessions can be connected to the template database while it is being copied." Keep the database that holds the fixture out of the test connection string, and point the tests at the clones.

## What the snapshot does not fix

The dump makes the rows repeatable. It does not make them better than the run that produced them. Cross-column arithmetic is not reconciled during generation, so a `subtotal` and a `total` that disagree in the generated rows disagree in the fixture too, on every restore. Multi-column `UNIQUE` constraints are not enforced during generation; Postgres still enforces them on insert, so a collision fails the run and the transaction rolls back rather than landing in a dump. Both are v0.x limits, listed in the [README](https://github.com/PasskeyBridge-LLC/satus#readme) under "Honest limits". The fixture diff is the one place a person reads the generated rows before tests depend on them, which is the reason to review it rather than regenerate and commit blind.

## Where satus stops in this workflow

In 0.3.11, satus covers the dry run and the write step. Everything after the write is plain `pg_dump`, `psql` and `createdb`. The [roadmap](https://github.com/PasskeyBridge-LLC/satus/blob/main/docs/ROADMAP.md) lists a `satus snapshot` command that would produce the restorable fixture in one step after a seed run; it is not in 0.3.11.

Start with the dry run against your own schema. It needs no key and writes nothing, and the [quickstart](/quickstart) has the install line.

## Sources

- Every transcript above: PostgreSQL 17.11 (Debian 17.11-0+deb13u1), `pg_dump` and `psql` 17.11, `@passkeybridge/satus@0.3.11` on Node 20.19.2, run 2026-09-26. The rows in `app_dev` were inserted with plain SQL, not by a real `satus generate` run.
- `--data-only`, `--restrict-key`, and `-X` on restore: the [`pg_dump` reference](https://www.postgresql.org/docs/17/app-pgdump.html).
- `\restrict` and CVE-2025-8714: [PostgreSQL 17.6 release notes](https://www.postgresql.org/docs/release/17.6/).
- Template copies: the [`CREATE DATABASE` reference](https://www.postgresql.org/docs/17/sql-createdatabase.html).
- The v0.x limits: the [README](https://github.com/PasskeyBridge-LLC/satus#readme) and the [troubleshooting page](/docs/troubleshooting).
- Earlier on the same question: [Fixtures vs generation, and when each wins](/blog/fixtures-vs-generation-when-each-wins), and the [E2E reset recipe](/recipes).
