---
slug: check-constraints-that-lie
title: "Postgres CHECK constraints: NULL and validation"
description: Postgres CHECK constraints accept a NULL result and skip existing rows when added NOT VALID. satus 0.3.12 does not read the predicate. now() cannot index.
date: 2026-06-17
author: satus.sh
tags: [postgres, constraints, schema, seeding]
draft: false
---

Correction, November 6, 2026: The original post described CHECK sampling, volatile-expression warnings, domain-chain introspection, `convalidated` handling, and `satus plan` output. The 0.3.12 binary has none of that. `satus plan` is an unknown command and exits 1. The examples below were run on 2026-11-06 against PostgreSQL 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), `psql` 17.11, Node v24.21.0, and `@passkeybridge/satus@0.3.12`. The session time zone was `UTC`.

Postgres evaluates a `CHECK` per row on `INSERT` or `UPDATE`. A `FALSE` result rejects the row. A `TRUE` or `NULL` result accepts it. `satus generate --dry-run` does not read the predicate. The coverage comment in [`validate.ts` at v0.3.12](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.12/packages/cli/src/generate/validate.ts) lists `CHECK` constraints as out of scope. A constraint that no row can satisfy, `quantity > 0 and quantity < 0`, left the dry run at exit 0 with no findings. Postgres still enforces the predicate on a real insert.

## NULL results pass

```sql
create table names (
  name text,
  constraint name_lower check (name = lower(name))
);
insert into names values (null);
insert into names values ('Ab');
insert into names values ('ab');
```

The `NULL` insert succeeds. `'Ab'` fails with `new row for relation "names" violates check constraint "name_lower"`. `'ab'` succeeds. `select name from names` shows a null and `ab`.

`CHECK (name = lower(name))` does not mean the column is present. `NOT NULL` is a separate constraint. `alter table names alter column name set not null` failed here with `column "name" of relation "names" contains null values` because the null row was still in the table.

If the column must be present and lowercase, declare both:

```sql
alter table domains
  alter column name set not null,
  add constraint name_lowercase check (name = lower(name));
```

Or write the null case into the predicate: `check (name is not null and name = lower(name))`. The two forms are equivalent only when the column has no nulls left to reject. The first is what `\d` prints as two constraints.

## NOT VALID checks new rows

```sql
create table legacy (n integer);
insert into legacy values (1), (-1);
alter table legacy add constraint n_positive check (n > 0) not valid;
```

The `ALTER` succeeds. The existing `-1` stays. A new `-2` is rejected: `new row for relation "legacy" violates check constraint "n_positive"`. The catalog row:

```
  conname   | convalidated 
------------+--------------
 n_positive | f
(1 row)
```

`convalidated` is a real `pg_constraint` column. The CLI does not query it, and there is no plan command that prints it. `alter table legacy validate constraint n_positive` then fails with `check constraint "n_positive" of relation "legacy" is violated by some row`. New and updated rows are checked. Existing rows are not, until `VALIDATE CONSTRAINT` succeeds.

## now() is not an index predicate

```sql
create table coupons (id int, expires_at timestamptz);
create index coupons_open on coupons (expires_at) where expires_at > now();
```

```
ERROR:  functions in index predicate must be marked IMMUTABLE
```

`now()` is not immutable. A partial index with that predicate is invalid, so it is not a stand-in for a `CHECK (expires_at > now())`. A plain index on the column is valid:

```sql
create index coupons_expires on coupons (expires_at);
insert into coupons values (1, timestamptz '2020-01-01+00');
select id from coupons where expires_at > now();
```

The insert succeeds. The filter returns no rows. The query can use `coupons_expires`. The predicate that rejected the partial index is not stored in the catalog as an index.

A `CHECK (expires_at > now())` would be evaluated at insert time. It would not keep the row "in the future" after that. A materialized view that stores `expires_at > now()` as a stored result has the same write-time meaning. Those are two different objects. The partial index is the one this server refused to create.

## Domain checks are on the type

```sql
create domain year_value as integer
  constraint year_check check (value >= 1901 and value <= 2155);
create table films (title text, release_year year_value);
insert into films values ('x', 1800);
```

```
ERROR:  value for domain year_value violates check constraint "year_check"
```

`insert into films values ('y', 2001)` succeeds. The constraint row is attached to the domain, not to `films`:

```
  conname   | convalidated | on_table |  typname   
------------+--------------+----------+------------
 year_check | t            | -        | year_value
(1 row)
```

`on_table` is `-` because `conrelid` is zero. A query that only reads `pg_constraint` rows for the table oid does not see `year_check`. The CLI's dry-run validator does not walk domain checks either. Postgres still enforces them on insert.

## A single-row CHECK that Postgres does enforce

```sql
check (total_cents = subtotal_cents + tax_cents)
check (shipped_at is null or shipped_at >= placed_at)
```

These reference the new row and immutable operators. Postgres rejects a violating insert. The dry run does not read them, so a clean dry run does not mean the row will pass. The order-total post on this blog shows a generated column for the sum and the shipping-date error from this server.

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.

## References

- PostgreSQL documentation, [CHECK constraints](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS).
- PostgreSQL documentation, [CREATE TABLE](https://www.postgresql.org/docs/17/sql-createtable.html).
- PostgreSQL documentation, [ALTER TABLE: NOT VALID and VALIDATE CONSTRAINT](https://www.postgresql.org/docs/17/sql-altertable.html).
- PostgreSQL documentation, [CREATE DOMAIN](https://www.postgresql.org/docs/17/sql-createdomain.html).
- PostgreSQL documentation, [pg_constraint](https://www.postgresql.org/docs/17/catalog-pg-constraint.html).
- PostgreSQL documentation, [CREATE INDEX](https://www.postgresql.org/docs/17/sql-createindex.html).
