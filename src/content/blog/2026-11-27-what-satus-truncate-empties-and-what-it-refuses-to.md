---
slug: what-satus-truncate-empties-and-what-it-refuses-to
title: What satus generate --truncate empties, and what it refuses to
description: satus 0.3.11 truncates only the tables it seeds, never with CASCADE, inside the run's transaction. A blocked truncate or failed run leaves every row in place.
date: 2026-11-27
publishAt: 2026-11-27T09:00:00-05:00
author: satus.sh
tags: [seeding, postgres, safety, truncate]
draft: false
---

`satus generate --truncate` empties the tables satus is about to seed, then seeds them. In `@passkeybridge/satus@0.3.11` that is one statement, `truncate <tables> restart identity`, run inside the same transaction as the inserts. It never adds `CASCADE`. If another table references one of the targets, the truncate fails and satus stops, and if anything later in the run fails, the truncate is rolled back with the rest. This post shows both cases with the shipped CLI. Every transcript below ran on PostgreSQL 17.11 with `psql` 17.11, against `@passkeybridge/satus@0.3.11`.

## The schema

Two tables to seed in `public`, and an `invoices` table in a separate `billing` schema that references `customers`:

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

create schema billing;

create table billing.invoices (
  id          integer generated always as identity primary key,
  customer_id integer not null references public.customers(id)
);
```

Some rows that should survive a run that does not complete:

```sql
insert into customers (email)
values ('a@example.test'), ('b@example.test'), ('c@example.test');

insert into orders (customer_id, total_cents)
values (1, 1200), (2, 3400), (3, 560);

insert into billing.invoices (customer_id) values (1);
```

## A dry run does not truncate

```
$ satus generate --dry-run --rows 25 --truncate

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

```
$ psql $DATABASE_URL -f count.sql
 customers | orders | max_customer_id 
-----------+--------+-----------------
         3 |      3 |               3
(1 row)
```

`--dry-run` returns before the transaction begins, so `--truncate` has no effect on it. The dry run cannot tell you whether the truncate would succeed. The next two runs can.

## A table outside the run set references a target

The run set is the tables in the schema being seeded, minus anything listed under `exclude` in `satus.config.json`. `billing.invoices` is in another schema, so it is outside the run set. A real run needs a provider key to get past its first checks; here the key is the string `placeholder`.

```
$ OPENAI_API_KEY=placeholder satus generate --rows 25 --truncate

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  truncating target tables...
error: --truncate cannot run: a table outside the run set has a foreign key into it. Table "invoices" references "customers".
  satus will not TRUNCATE ... CASCADE, because that would also empty a table you did not ask it to seed.
  Either bring the referencing table into the run set (remove it from "exclude" in satus.config.json), or truncate it yourself first.
```

The code is in [`writer.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/writer.ts). It issues one `truncate ... restart identity` statement that names every table in the run set, here `customers` and `orders`. Postgres refuses to truncate a table that another table references unless that table is in the same statement or `CASCADE` is given, and returns SQLSTATE `0A000`. satus turns that code into the message above and exits `1`. Adding `CASCADE` would empty `billing.invoices`, a table nobody asked satus to touch.

The truncate ran inside the transaction, so nothing changed:

```
$ psql $DATABASE_URL -f count.sql
 customers | orders | max_customer_id 
-----------+--------+-----------------
         3 |      3 |               3
(1 row)
```

## The truncate succeeds and the run fails

Drop the referencing table and run again with the same placeholder key:

```sql
drop table billing.invoices;
```

```
$ OPENAI_API_KEY=placeholder satus generate --rows 25 --truncate

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  truncating target tables...
  customers error: OpenAI 401: {
    "error": {
        "message": "Incorrect API key provided: placeholder. You can find your API key at https://platform.openai.com/account/api-keys.",
        "type": "invalid_request_error",
        "param": null,
        "code": "invalid_api_key"
    }
}
```

This time the truncate succeeded. The first provider call then failed with a `401`, because `placeholder` is not a key. satus rolled back the transaction and exited `1`. The three customers and three orders are still there:

```
$ psql $DATABASE_URL -f count.sql
 customers | orders | max_customer_id 
-----------+--------+-----------------
         3 |      3 |               3
(1 row)
```

`restart identity` was rolled back as well. The next customer gets `id` 4, not 1:

```
$ psql $DATABASE_URL -f next-id.sql
 id 
----
  4
(1 row)

INSERT 0 1
```

The [PostgreSQL 17 `TRUNCATE` reference](https://www.postgresql.org/docs/17/sql-truncate.html) states both halves: "TRUNCATE is transaction-safe with respect to the data in the tables", and with `RESTART IDENTITY` "the implied ALTER SEQUENCE RESTART operations are also done transactionally".

## What this means for a run

- `--truncate` touches only the tables in the run set, in the schema being seeded.
- A table outside the run set that references a target blocks the truncate. Bring it into the run, or truncate it yourself first, as the message says.
- Any failure after the truncate, from the provider, the database or `--max-cost`, rolls the truncate back with everything else.
- The [row guard](/blog/how-satus-decides-a-database-is-too-full-to-seed) runs before the transaction and counts the rows that are there before the truncate. A database with more than 10,000 rows is refused with exit `11` whether or not `--truncate` is set, unless you pass `--force`.

The published v0.x limits apply to the rows a successful run inserts: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
