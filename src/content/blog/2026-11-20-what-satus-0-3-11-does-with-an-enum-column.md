---
slug: what-satus-0-3-11-does-with-an-enum-column
title: What satus 0.3.12 does with a Postgres enum column
description: satus 0.3.12 maps an enum column to a string and does not read pg_enum. Postgres ADD VALUE, sort order, and a label update that follows new labels.
date: 2026-11-20
publishAt: 2026-11-20T09:00:00-05:00
author: satus.sh
tags: [postgres, enums, schema, seeding]
draft: false
---

`@passkeybridge/satus@0.3.12` does not read the labels of a Postgres enum type. An enum column is mapped to a JSON string with no list of allowed values. The dry run's simulator fills an unconstrained string with `<column>_<n>`, and the dry run reports no finding when that string is not a label. The installed package has no `pg_enum` query and no `EnumOutOfDomain` string.

Every transcript below ran on 2026-11-06 against PostgreSQL 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), `psql` 17.11, Node v24.21.0, and `@passkeybridge/satus@0.3.12`, with no provider key. `DATABASE_URL` is `postgresql://postgres:postgres@127.0.0.1:5433/enum_dev`.

An earlier post, [Postgres enum changes and satus enum handling](/blog/enum-types-that-grew-up), used to describe label introspection, weights, and `EnumOutOfDomain`. Those commands are not in this binary. This post is the 0.3.12 behavior.

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
   typname    | enumlabel | enumsortorder 
--------------+-----------+---------------
 order_status | pending   |             1
 order_status | paid      |             2
 order_status | shipped   |             3
(3 rows)
```

## What the dry run does with the column

`status` has no default, so it is a column the model is asked to fill. The property type falls through to string. The description attached when the column name contains `status` is `A status keyword. Prefer values typical for the domain (active, pending, archived, etc.).` The user prompt in `runner.ts` adds `For status / enum-like text columns, choose values that read as plausible domain vocabulary.` The `saas` profile mentions feature-flag and billing-plan words (`free`, `pro`, `team`). None of those is this enum's label list.

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

The exit code is 0. The simulator's string fallback is `` `${name}_${n}` ``, so the first value is `status_1`. Inserting that value fails. Inserting a real label succeeds:

```sql
insert into orders (status, created_at) values ('status_1', timestamptz '2026-11-06 00:00+00');
insert into orders (status, created_at) values ('pending', timestamptz '2026-11-06 00:00+00');
```

```
ERROR:  invalid input value for enum order_status: "status_1"
LINE 1: insert into orders (status, created_at) values ('status_1', ...
                                                        ^
INSERT 0 1
```

A real run would send model output to Postgres, which rejects a label that is not in the type. The dry run does not.

## Adding a label

```sql
alter type order_status add value 'authorized' before 'paid';
alter type order_status add value 'draft' before 'pending';
alter type order_status add value 'archived';
```

```
 enumlabel  | enumsortorder 
------------+---------------
 draft      |             0
 pending    |             1
 authorized |           1.5
 paid       |             2
 shipped    |             3
 archived   |             4
(6 rows)
```

In this example, adding `authorized` before `paid` gives it `enumsortorder` 1.5. Adding `draft` before the first label and appending `archived` used integers, 0 and 4. Those positions are what this catalog stored. Postgres can also renumber sort positions. Comparison follows `enumsortorder`, so `draft` sorts before `pending` even though `draft` is later in the alphabet.

A new label cannot be used in the transaction that added it:

```sql
begin;
alter type order_status add value 'held';
insert into orders (status, created_at) values ('held', timestamptz '2026-11-06 00:00+00');
rollback;
```

```
BEGIN
ALTER TYPE
ERROR:  unsafe use of new value "held" of enum type order_status
LINE 1: insert into orders (status, created_at) values ('held', time...
                                                        ^
HINT:  New enum values must be committed before they can be used.
ROLLBACK
```

There is still no `ALTER TYPE ... DROP VALUE`. Removing a label means a new type, a rewrite, and a rename. That rewrite takes `ACCESS EXCLUSIVE` on every table that uses the type.

## Labels the statement follows

After the six labels above exist, this reload uses every label, including ones added after the type was created. `1 + (id - 1) % cardinality(...)` walks the array from index 1. A hard-coded `% 5` would skip the sixth label.

```sql
truncate orders restart identity;
insert into orders (status, created_at)
select 'pending', timestamptz '2026-11-06 00:00+00'
from generate_series(1, 12) g;

update orders
set status = (enum_range(null::order_status))[
  1 + (id - 1) % cardinality(enum_range(null::order_status))
];

select status, count(*) from orders group by status order by status;
```

```
TRUNCATE TABLE
INSERT 0 12
UPDATE 12
   status   | count 
------------+-------
 draft      |     2
 pending    |     2
 authorized |     2
 paid       |     2
 shipped    |     2
 archived   |     2
(6 rows)
```

`authorized`, `draft`, and `archived` are in the result. Every row in this table was written by that update. A table that already had other labels would keep them until the same update ran.

If `status` has a default, `schema.ts` omits the column from the generated insert and Postgres applies the default. Every newly inserted `orders` row then uses that default. Rows already in the table are unchanged.

## Excluded lookup rows are absent from the parent pool

```sql
create table currencies (
  code char(3) primary key
);
insert into currencies (code) values ('USD'), ('EUR'), ('GBP'), ('JPY'), ('CAD');

create table shipments (
  id integer generated always as identity primary key,
  currency_code char(3) not null references currencies(code),
  status order_status not null default 'pending'
);
```

Five currency codes are already in the table. With `satus.config.json` containing `{"exclude": ["currencies"]}`, the dry run plans `orders` and `shipments` and then fails, because the FK pool is rows this run inserted, not rows already stored:

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
  shipments                        25 rows  ~$0.0027

  estimated cost: $0.0054

  simulating + validating...
  orders . (dry-run)
  shipments error: No parent rows available for shipments.currency_code -> currencies.code. Check that currencies is in the run set and not excluded.
```

The exit code is 1. Nothing was written. Removing the exclude puts `currencies` in the plan. The dry run then exits 0 and reports no findings. That does not promise a real run will insert. `code` is a primary key, and the validator's unique-column check reads single-column `UNIQUE` constraints, not primary keys. The simulator caps `char(3)` strings. Existing codes, or repeated generated codes, can still make the insert fail. `orders.status` is still an enum the model is asked to fill when it has no default.

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
