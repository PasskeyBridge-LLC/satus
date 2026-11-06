---
slug: what-satus-truncate-empties-and-what-it-refuses-to
title: What satus generate --truncate empties, and when Postgres blocks it
seoTitle: What satus generate --truncate empties, and when it blocks
description: satus 0.3.12 names the run-set tables in one TRUNCATE without CASCADE. Postgres still blocks a separate truncate, and rolls the statement back on failure.
date: 2026-11-27
publishAt: 2026-11-27T09:00:00-05:00
author: satus.sh
tags: [seeding, postgres, safety, truncate]
draft: false
---

`satus generate --truncate` empties tables and then seeds them. In `@passkeybridge/satus@0.3.12` that is one statement, `truncate <tables> restart identity`, inside the same transaction as the inserts. The statement does not add `CASCADE` and does not add `ONLY`. satus names the tables in the run set. PostgreSQL also truncates their descendants.

The run set is the tables introspection keeps for the schema: ordinary tables and partitioned parents, with partition children collapsed onto the parent, minus `exclude`. On the free tier the list is then cut to five tables. If a table outside that statement has a foreign key into a table inside it, Postgres rejects the truncate even when the referencing table is empty.

Every transcript below ran on 2026-11-06 against PostgreSQL 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), `psql` 17.11, Node v24.21.0, and `@passkeybridge/satus@0.3.12`. `DATABASE_URL` for the invoice example is `postgresql://postgres:postgres@127.0.0.1:5433/trunc_dev`.

## The schema

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

insert into customers (email) values ('a@example.test'), ('b@example.test');
insert into orders (customer_id, total_cents) values (1, 100), (2, 200);
insert into billing.invoices (customer_id) values (1);

select
  (select count(*) from customers) as customers,
  (select count(*) from orders) as orders,
  (select count(*) from billing.invoices) as invoices;
```

```
 customers | orders | invoices 
-----------+--------+----------
         2 |      2 |        1
(1 row)
```

`customers_id_seq` and `orders_id_seq` are at `last_value` 2, `is_called` true.

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

The counts are still 2, 2, and 1. `customers_id_seq.last_value` is still 2. `--dry-run` returns before the write transaction, so the flag is a no-op for the table.

The plan names `customers` and `orders`. `billing.invoices` is outside `--schema public`, so it is outside the run set. An `orders` to `customers` foreign key inside the same statement does not block the truncate. A foreign key from a table that is not in the statement does.

## The row guard runs first

On a database whose only table holds 10,001 rows, `OPENAI_API_KEY=placeholder satus generate --rows 25 --truncate` exits 11 with the usual refusal and never prints `truncating target tables...`. `select count(*)` is still 10001. The placeholder was not sent: `fetch` was disabled and the process still exited 11.

## Postgres rejects a referencing table that is not in the statement

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

The exit code is 1. The counts are still 2, 2, and 1, and `customers_id_seq.last_value` is still 2. The transaction rolled back.

The last line of that message says to truncate the referencing table first. That does not clear a later `TRUNCATE` of `customers`. Postgres checks the foreign-key relationship, not whether `invoices` has rows. After truncating `invoices` on its own, `invoices` is empty and this still fails:

```sql
truncate public.customers, public.orders restart identity;
```

```
ERROR:  cannot truncate a table referenced in a foreign key constraint
DETAIL:  Table "invoices" references "customers".
HINT:  Truncate table "invoices" at the same time, or use TRUNCATE ... CASCADE.
```

An empty referencing table is enough. After all three tables were emptied and one new customer was inserted, `orders` had zero rows and still blocked `truncate public.customers`:

```
ERROR:  cannot truncate a table referenced in a foreign key constraint
DETAIL:  Table "orders" references "customers".
HINT:  Truncate table "orders" at the same time, or use TRUNCATE ... CASCADE.
```

`--schema public` cannot put `billing.invoices` into the run set by removing an `exclude` entry. The working reset names every affected table in one statement, and the seed after that does not need `--truncate`:

```sql
truncate public.orders, public.customers, billing.invoices restart identity;

select
  (select count(*) from customers) as customers,
  (select count(*) from orders) as orders,
  (select count(*) from billing.invoices) as invoices;

select last_value, is_called from customers_id_seq;
```

```
TRUNCATE TABLE
 customers | orders | invoices 
-----------+--------+----------
         0 |      0 |        0
(1 row)

 last_value | is_called 
------------+-----------
          1 | f
(1 row)
```

## Rollback restores the truncate and the identity restart

Load three customers, three orders, and three invoices. `customers_id_seq.last_value` is 3. Then:

```sql
begin;
truncate public.orders, public.customers, billing.invoices restart identity;
select count(*) as customers_inside from customers;
select last_value as seq_inside, is_called from customers_id_seq;
rollback;
select count(*) as customers_after from customers;
select last_value as seq_after, is_called from customers_id_seq;
```

```
BEGIN
TRUNCATE TABLE
 customers_inside 
------------------
                0
(1 row)

 seq_inside | is_called 
------------+-----------
          1 | f
(1 row)

ROLLBACK
 customers_after 
-----------------
               3
(1 row)

 seq_after | is_called 
-----------+-----------
         3 | t
(1 row)
```

The CLI issues its truncate inside the same transaction as the inserts. A failure after the truncate rolls the truncation back, including `RESTART IDENTITY`. That is not true of an ordinary `nextval`: a rolled-back insert can leave the sequence advanced. The [row guard post](/blog/how-satus-decides-a-database-is-too-full-to-seed) shows that case.

## Descendants

The CLI text is `truncate schema.table restart identity` with no `ONLY`. On a table that has an inheritance child, that statement empties the child too. `truncate only` leaves the child. This pair is `trunc_inh`, with no foreign keys:

```sql
create table notes (id int, body text);
create table vip_notes (tier text) inherits (notes);
insert into notes values (1, 'a');
insert into vip_notes values (2, 'v', 'gold');
```

`select count(*) from notes` is 2. `select count(*) from only notes` is 1. `select count(*) from vip_notes` is 1.

```sql
begin;
truncate notes;
select count(*) as notes_after_truncate from notes;
select count(*) as vip_after_truncate from vip_notes;
rollback;
```

```
 notes_after_truncate 
----------------------
                    0
(1 row)

 vip_after_truncate 
--------------------
                  0
(1 row)
```

After rollback, the same rows are back. `truncate only notes` then leaves `vip_notes` at 1, and `select count(*) from notes` is 1 because that read still sees the child. The CLI does not emit `ONLY`.

## What the run set leaves out

Partition children are not separate seed targets. On `trunc_dev`, `events` is partitioned and `events_2026` is its child. The free tier also stops at five tables. The schema introspection counted 10 tables (`customers`, `orders`, an inheritance child of `customers`, `events`, and `t1` through `t6`). `events_2026` was not one of the 10. The dry run said so and named five:

```
$ satus generate --dry-run --rows 25 --schema public
! Free tier capped at 5 tables (schema has 10). Run `satus activate <key>` to unlock all tables.

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> events -> t1 -> t2 -> t3

  customers                        25 rows  ~$0.0018
  events                           25 rows  ~$0.0018
  t1                               25 rows  ~$0.0009
  t2                               25 rows  ~$0.0009
  t3                               25 rows  ~$0.0009

  estimated cost: $0.0063

  simulating + validating...
  customers . (dry-run)
  events . (dry-run)
  t1 . (dry-run)
  t2 . (dry-run)
  t3 . (dry-run)

  ✓ no validation findings across 5 tables
```

`orders`, `t4`, `t5`, and `t6` are in the schema and not in this run set. A `--truncate` on this plan would name those five tables. Because `orders` references `customers` and `orders` is not in the five, Postgres rejects that statement the same way it rejected the invoice case.

`truncate events` with no `ONLY`, on this database, also empties `events_2026`. One row inserted into the parent showed up in the child, the truncate took it to 0, and rollback put it back:

```
 child_before 
--------------
            1
(1 row)

 child_after 
-------------
           0
(1 row)

 child_restored 
----------------
              1
(1 row)
```

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
