---
slug: what-satus-0-3-11-does-with-an-enum-column
title: What satus 0.3.11 does with a Postgres enum column
description: satus 0.3.11 treats an enum column as a plain string with no label list. What Postgres allows when an enum changes, and how to seed enum columns today.
date: 2026-11-20
publishAt: 2026-11-20T09:00:00-05:00
author: satus.sh
tags: [postgres, enums, schema, seeding]
draft: false
---

`@passkeybridge/satus@0.3.11` does not read the labels of a Postgres enum type. An enum column is mapped to a JSON string with no list of allowed values, the dry run's simulator fills it with a placeholder that is not a label, and the dry run reports no finding. This post shows that with the shipped CLI, then what Postgres lets you do to an enum after it ships, and a way to seed enum columns with 0.3.11 that does not depend on the model choosing a valid label. Every transcript below ran on PostgreSQL 17.11 with `psql` 17.11, against `@passkeybridge/satus@0.3.11`, with no provider key in the environment.

An earlier post on this blog, [Enum types that grew up](/blog/enum-types-that-grew-up) (2026-06-22), describes satus reading labels from `pg_enum`, weighting them, and an `EnumOutOfDomain` dry-run finding. None of those exist in 0.3.11. This post describes the shipped behaviour.

## The schema

```sql
create type order_status as enum ('pending', 'paid', 'shipped');

create table orders (
  id         integer generated always as identity primary key,
  status     order_status not null,
  created_at timestamptz not null
);
```

The labels and their order live in `pg_enum`:

```sql
select t.typname, e.enumlabel, e.enumsortorder
from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'order_status'
order by e.enumsortorder;
```

```
$ psql $DATABASE_URL -f labels.sql
   typname    | enumlabel | enumsortorder 
--------------+-----------+---------------
 order_status | pending   |             1
 order_status | paid      |             2
 order_status | shipped   |             3
(3 rows)
```

## How satus sees the column

`information_schema.columns` reports the type as `USER-DEFINED`, with the enum's name in `udt_name`:

```sql
select column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'orders'
order by ordinal_position;
```

```
$ psql $DATABASE_URL -f columns.sql
 column_name |        data_type         |   udt_name   
-------------+--------------------------+--------------
 id          | integer                  | int4
 status      | USER-DEFINED             | order_status
 created_at  | timestamp with time zone | timestamptz
(3 rows)
```

satus maps a column to a JSON type by `udt_name` in [`schema.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/schema.ts). `order_status` matches none of the cases, so it falls through to the default, `{ type: "string" }`. Introspection does not query `pg_enum`, so there is no label list to add. The only extra guidance comes from the column name: a name containing `status` gets the description "A status keyword. Prefer values typical for the domain (active, pending, archived, etc.)." The model is asked for a status keyword and is not told which three are legal.

The dry run passes:

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   orders

  orders                           25 rows  ~$0.0027

  estimated cost: $0.0027

  simulating + validating...
  orders . (dry-run)

  ✓ no validation findings across 1 tables
```

The simulator in [`simulate.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/simulate.ts) fills a plain string column with `<column>_<n>`, so the first simulated row has `status = 'status_1'`. The validator's string check covers type and varchar length, and passes it. Postgres does not:

```sql
insert into orders (status, created_at)
values ('status_1', '2026-01-01T00:00:00.000Z');
```

```
$ psql $DATABASE_URL -f insert-sim.sql
psql:insert-sim.sql:2: ERROR:  invalid input value for enum order_status: "status_1"
LINE 2: values ('status_1', '2026-01-01T00:00:00.000Z');
                ^
```

On a real run, a value outside the enum fails the insert, the transaction rolls back, and the database is left as it was. Whether a given real run hits that depends on what the model returns for that column, which the dry run cannot tell you.

## What Postgres allows when an enum changes

On PostgreSQL 17, `ALTER TYPE ... ADD VALUE` runs inside a transaction block, but the new label cannot be used until the transaction commits:

```sql
begin;
alter type order_status add value 'refunded';
insert into orders (status, created_at) values ('refunded', now());
rollback;
```

```
$ psql $DATABASE_URL -f add-in-txn.sql
BEGIN
ALTER TYPE
psql:add-in-txn.sql:3: ERROR:  unsafe use of new value "refunded" of enum type order_status
LINE 1: insert into orders (status, created_at) values ('refunded', ...
                                                        ^
HINT:  New enum values must be committed before they can be used.
ROLLBACK
```

A migration that adds a label and backfills rows with it in the same transaction fails. Split it into two migrations, or two transactions.

New labels go at the end unless you say otherwise. `BEFORE` and `AFTER` place a label between two others, and Postgres records the position as a fractional `enumsortorder`:

```sql
alter type order_status add value 'refunded';
alter type order_status add value 'authorized' before 'paid';
```

```
$ psql $DATABASE_URL -f labels.sql
   typname    | enumlabel  | enumsortorder 
--------------+------------+---------------
 order_status | pending    |             1
 order_status | authorized |           1.5
 order_status | paid       |             2
 order_status | shipped    |             3
 order_status | refunded   |             4
(5 rows)
```

Comparison and `order by` on an enum column follow `enumsortorder`, not the label text and not the order the labels were added in:

```sql
select array_agg(s order by s) as sorted
from unnest(enum_range(null::order_status)) s;

select 'shipped'::order_status > 'paid'::order_status as shipped_after_paid,
       'authorized'::order_status < 'paid'::order_status as authorized_before_paid;
```

```
$ psql $DATABASE_URL -f order.sql
                   sorted                   
--------------------------------------------
 {pending,authorized,paid,shipped,refunded}
(1 row)

 shipped_after_paid | authorized_before_paid 
--------------------+------------------------
 t                  | t
(1 row)
```

A label cannot be removed:

```sql
alter type order_status drop value 'authorized';
```

```
$ psql $DATABASE_URL -f drop.sql
psql:drop.sql:1: ERROR:  dropping an enum value is not implemented
LINE 1: alter type order_status drop value 'authorized';
                                ^
```

Removing one means creating a new type without it, converting every column that uses the old type, and dropping the old type. A label can be renamed in place, and it keeps its position in the order:

```sql
alter type order_status rename value 'shipped' to 'dispatched';
```

```
$ psql $DATABASE_URL -f rename.sql
ALTER TYPE
```

## A lookup table does not help in 0.3.11

The usual alternative to an enum is a lookup table with a foreign key. satus resolves foreign keys from parent rows it inserted in the same run, so it seeds the lookup table too:

```sql
create table order_statuses (
  code text primary key
);
insert into order_statuses (code)
values ('pending'), ('authorized'), ('paid'), ('dispatched'), ('refunded');

create table shipments (
  id          integer generated always as identity primary key,
  status_code text not null references order_statuses(code)
);
```

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   order_statuses -> orders -> shipments

  order_statuses                   25 rows  ~$0.0009
  orders                           25 rows  ~$0.0027
  shipments                        25 rows  ~$0.0018

  estimated cost: $0.0054

  simulating + validating...
  order_statuses . (dry-run)
  orders . (dry-run)
  shipments . (dry-run)

  ✓ no validation findings across 3 tables
```

`order_statuses` is in the plan with 25 rows to generate, on top of the five real codes. A real run would insert 25 model-generated codes and point `shipments` at those. Excluding the table in `satus.config.json` keeps its rows untouched, but then satus has no parent rows to draw from:

```
$ cat satus.config.json
{
  "exclude": ["order_statuses"]
}
```

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   orders -> shipments

  orders                           25 rows  ~$0.0027
  shipments                        25 rows  ~$0.0018

  estimated cost: $0.0045

  simulating + validating...
  orders . (dry-run)
  shipments error: No parent rows available for shipments.status_code -> order_statuses.code. Check that order_statuses is in the run set and not excluded.
```

The run stops with exit `1`.

## Seeding enum columns with 0.3.11

satus leaves out any column the database fills itself, including columns with a `DEFAULT`, so the model is never asked for a value. Starting again from `orders` alone, give `status` a default:

```sql
alter table orders alter column status set default 'pending';
```

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   orders

  orders                           25 rows  ~$0.0027

  estimated cost: $0.0027

  simulating + validating...
  orders . (dry-run)

  ✓ no validation findings across 1 tables
```

After a seed run, every row has `status = 'pending'`. Spread the rows across the labels with one `UPDATE`, using `enum_range` so the statement follows the type when labels are added. Here 20 rows inserted with `psql` stand in for a seed run's output:

```sql
insert into orders (created_at)
select timestamptz '2026-01-01' - g * interval '1 day'
from generate_series(1, 20) g;
```

```sql
update orders
set status = (enum_range(null::order_status))[1 + id % 5];

select status, count(*)
from orders
group by status
order by status;
```

```
$ psql $DATABASE_URL -f spread.sql
UPDATE 20
   status   | count 
------------+-------
 pending    |     4
 authorized |     4
 paid       |     4
 dispatched |     4
 refunded   |     4
(5 rows)
```

`enum_range(null::order_status)` returns the labels in `enumsortorder`, so the `UPDATE` uses the type's current labels in their current order, including `authorized`, added with `BEFORE`, and `dispatched`, renamed from `shipped`. A real distribution, for example mostly `paid` with a few `refunded`, is a `case` expression over `id` or `random()` in the same `UPDATE`. Run it in the same script as the seed so that the fixture you snapshot with `pg_dump` has it.

The published v0.x limits apply here too: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
