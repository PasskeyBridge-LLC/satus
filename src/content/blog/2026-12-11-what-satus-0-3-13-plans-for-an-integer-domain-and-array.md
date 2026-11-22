---
slug: what-satus-0-3-13-plans-for-an-integer-domain-and-array
title: What satus 0.3.13 plans for an integer domain and an integer array
seoTitle: What 0.3.13 plans for a domain and an array
description: satus 0.3.13 reads a domain column as int4 and does not report its check. An integer[] udt is _int4, the dry run accepts a string, and Postgres rejects tags_1.
date: 2026-12-11
publishAt: 2026-12-11T09:00:00-05:00
author: satus.sh
tags: [postgres, schema, seeding, types]
draft: false
---

`information_schema.columns` reports a column of domain `cents` as `data_type` `integer` and `udt_name` `int4`. `pg_type` says `cents` has `typtype` `d` and base type `integer`. `@passkeybridge/satus@0.3.13` reads `udt_name` from `information_schema.columns`, in [`introspect.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/introspect.ts). `int4` is in the type switch in [`schema.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/schema.ts), so the dry run plans `total_cents` as an integer. The domain check is not a finding.

The array column `tags` has `udt_name` `_int4`. That name is not in the switch, so the column is planned as a string. The dry run exits 0. Postgres rejects the string `tags_1`.

Every transcript below ran on 2026-11-22 against PostgreSQL 17.12 (`PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit`), `psql` (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), Node v24.21.0, and `@passkeybridge/satus@0.3.13`. `npm view @passkeybridge/satus version` printed `0.3.13`. No provider key was set. The catalog queries and the dry run used `postgresql://postgres:postgres@127.0.0.1:5433/types_dev`. The inserts used `types_dev2`, created from the same SQL, so the identity sequence started unused.

```sql
select version();
```

```
 PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)
```

## The schema

```sql
create domain cents as integer check (value >= 0);

create table invoices (
  id          integer generated always as identity primary key,
  total_cents cents not null,
  tags        integer[] not null
);
```

```
CREATE DOMAIN
CREATE TABLE
```

## What the catalogs report

```sql
select column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'invoices'
order by ordinal_position;
```

```
 column_name | data_type | udt_name 
-------------+-----------+----------
 id          | integer   | int4
 total_cents | integer   | int4
 tags        | ARRAY     | _int4
(3 rows)
```

`information_schema.columns` names the base type. The domain row is in `pg_type`:

```sql
select t.typname, t.typtype, format_type(t.typbasetype, null) as base
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public' and t.typname = 'cents';
```

```
 typname | typtype |  base   
---------+---------+---------
 cents   | d       | integer
(1 row)
```

`typtype` `d` is a domain. The array type `_int4` is a base type (`typtype` `b`) in category `A`:

```sql
select typname, typtype, typcategory
from pg_type
where typname in ('_int4', 'cents', 'int4')
order by typname;
```

```
 typname | typtype | typcategory 
---------+---------+-------------
 _int4   | b       | A
 cents   | d       | N
 int4    | b       | N
(3 rows)
```

## The dry run

Stderr was empty. The exit code is 0.

```
$ satus generate --dry-run --rows 25 --profile saas

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-6-luna
  rows:     25 per table
  tables:   invoices

  invoices                         25 rows  ~$0.0021

  estimated cost: $0.0021

  simulating + validating...
  invoices . (dry-run)

  ✓ no validation findings across 1 tables
```

`validate.ts` at the same tag accepts a string for any `udt_name` that is not in its switch, and it does not read `CHECK` constraints. The [23 October post](/blog/what-satus-0-3-11-checks-before-a-write) shows that gap for `CHECK` constraints on ordinary columns. This dry run also reports nothing for `cents_check`, which lives on the domain.

`simulate.ts` at the same tag, for a string column whose name is not email, url, or phone, builds the value from the column name, an underscore, and the 1-based index. For `tags` that value is `tags_1`. For an `int4` column the same file emits an integer. The `int4` minimum in `schema.ts` is negative, and that branch then uses `i + 1`, so the first value is 1. The dry run printed no `type_mismatch` finding. It did not print the simulated row.

## What Postgres does with those values

```sql
insert into invoices (total_cents, tags) values ('total_cents_1', array[1]);
insert into invoices (total_cents, tags) values (1, 'tags_1');
insert into invoices (total_cents, tags) values (-1, array[1]);
insert into invoices (total_cents, tags) values (1, array[1]);
select id, total_cents, tags from invoices;
select last_value, is_called from invoices_id_seq;
```

```
ERROR:  invalid input syntax for type integer: "total_cents_1"
LINE 1: insert into invoices (total_cents, tags) values ('total_cent...
                                                         ^
ERROR:  malformed array literal: "tags_1"
LINE 1: ...sert into invoices (total_cents, tags) values (1, 'tags_1');
                                                             ^
DETAIL:  Array value must start with "{" or dimension information.
ERROR:  value for domain cents violates check constraint "cents_check"
INSERT 0 1
 id | total_cents | tags 
----+-------------+------
  2 |           1 | {1}
(1 row)

 last_value | is_called 
------------+-----------
          2 | t
(1 row)
```

`total_cents_1` is rejected as integer input. `tags_1` is rejected as an array literal. `-1` reaches the domain check and violates `cents_check`. The stored row is `id` 2. `invoices_id_seq.last_value` is 2 and `is_called` is true, so an identity value was taken for a row that is not in the table.

An enum column is the same string fall-through, with a different catalog. That case is the [20 November post](/blog/what-satus-0-3-11-does-with-an-enum-column).

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
