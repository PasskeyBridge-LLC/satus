---
slug: enum-types-that-grew-up
title: Postgres enum changes and satus enum handling
description: How Postgres adds enum labels, records enumsortorder, and blocks a new label in the same transaction. satus 0.3.12 does not read pg_enum labels.
date: 2026-06-22
author: satus.sh
tags: [postgres, enums, schema, seeding]
draft: false
---

Correction, November 6, 2026: The original post described enum-label introspection, weighted enum sampling, interactive weights, lockfiles, and `EnumOutOfDomain` validation. None of that is in `@passkeybridge/satus@0.3.12` or in 0.3.11. `satus introspect` and `satus plan` are unknown commands and exit 1. The examples below were run on 2026-11-06 against PostgreSQL 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), `psql` 17.11, Node v24.21.0, and `@passkeybridge/satus@0.3.12`.

## Create the type

```sql
create type order_status as enum ('pending', 'paid', 'shipped');

select e.enumlabel, e.enumsortorder
from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'order_status'
order by e.enumsortorder;
```

```
 enumlabel | enumsortorder 
-----------+---------------
 pending   |             1
 paid      |             2
 shipped   |             3
(3 rows)
```

Labels are rows in `pg_enum`. Comparison uses `enumsortorder`, a `real`, not the label text. The values on disk are the enum oids.

## What satus 0.3.12 does

`satus introspect` prints `error: unknown command 'introspect'` and then the usage text, and exits 1. `satus plan` prints `error: unknown command 'plan'` and exits 1. The generate command maps an enum column to a JSON string. It does not query `pg_enum`. The dry-run validator does not check that a string is one of the labels. A column whose name contains `status` gets the description `A status keyword. Prefer values typical for the domain (active, pending, archived, etc.).` That string is not the label list.

On a table with `status order_status not null` and `created_at timestamptz not null`, `satus generate --dry-run --rows 25` exits 0 and reports no findings. Inserting the simulator's string shape fails:

```sql
insert into orders (status, created_at)
values ('status_1', timestamptz '2026-11-06 00:00+00');
```

```
ERROR:  invalid input value for enum order_status: "status_1"
```

Inserting `'pending'` succeeds. Postgres enforces the label list on insert. The dry run does not.

## ADD VALUE

One label per statement. `BEFORE` and `AFTER` place it. In this catalog, adding `authorized` before `paid` stored `enumsortorder` 1.5. Adding `draft` before the first label stored 0. Appending `archived` stored 4.

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

A new label cannot be used in the transaction that added it:

```
ERROR:  unsafe use of new value "held" of enum type order_status
HINT:  New enum values must be committed before they can be used.
```

```sql
alter type order_status drop value 'archived';
```

```
ERROR:  dropping an enum value is not implemented
```

Removing a label means a new type and a table rewrite.

To assign existing rows across every current label, including labels added later:

```sql
update orders
set status = (enum_range(null::order_status))[
  1 + (id - 1) % cardinality(enum_range(null::order_status))
];
```

On 12 identity ids starting at 1, that update used each of the six labels twice. A hard-coded remainder against 5 does not use a sixth label.

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
