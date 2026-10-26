---
slug: generated-columns-are-load-bearing-now
title: "Generated columns are load-bearing now"
seoTitle: "Postgres generated column: cannot insert a non-DEFAULT value"
description: Postgres GENERATED columns became infrastructure with STORED in PG12 and VIRTUAL in PG18. What that means for introspection, INSERT order and seeders.
date: 2026-07-13
author: satus.sh
tags: [postgres, generated-columns, schema, seeding]
draft: false
---

A `GENERATED` column in Postgres is a column whose value is not written by the client but computed from other columns in the same row by an expression the database enforces. Since [PostgreSQL 12](https://www.postgresql.org/docs/12/ddl-generated-columns.html) the `STORED` variant has been in the core; since [PostgreSQL 18](https://www.postgresql.org/docs/18/ddl-generated-columns.html) the `VIRTUAL` variant is in the core too, and the default. For a tool like [satus](/) that has to produce rows the database will accept on the first try, that is a category change: the column looks like every other column to a `SELECT`, but any `INSERT` that names it in the column list is a hard error, and any `INSERT` that omits it still has to satisfy every downstream constraint, index, and foreign key that references the value the database is about to compute. This post is the field guide to reading them out of the catalog, planning around them, and two anti-patterns worth naming in schemas that adopted them recently.

## The short version

Postgres computes the value of a generated column from an immutable expression over the row being written; the client cannot supply the value and can only write `DEFAULT` (or leave the column out entirely). A `STORED` generated column is materialised on disk at write time and behaves, for storage and index purposes, like a regular column. A `VIRTUAL` generated column is computed on read and stores nothing. Both kinds appear in `pg_attribute` with `attgenerated` set to `'s'` or `'v'`; a naive introspector that ignores `attgenerated` will try to `INSERT` into them and Postgres returns `ERROR: cannot insert a non-DEFAULT value into column "…"` with `DETAIL: Column "…" is a generated column.` on the first row. That is the observable symptom; the underlying rule is the [restriction list in the DDL chapter](https://www.postgresql.org/docs/current/ddl-generated-columns.html).

## Stored vs virtual, at the level a seeder cares about

| Property | `STORED` (PG12+) | `VIRTUAL` (PG18+) |
| --- | --- | --- |
| Value materialised on disk | Yes | No, computed on read |
| Can be indexed | Yes | No; PG18.0 rejects with `indexes on virtual generated columns are not supported` |
| `UNIQUE` or `PRIMARY KEY` on the column | Yes | No; same rejection path as index |
| `FOREIGN KEY` constraint on the column | Yes | No; PG18.0 rejects with `foreign key constraints on virtual generated columns are not supported` |
| `CHECK` constraint on the column | Yes | Yes; the executor evaluates the CHECK against the read-time value |
| Expression can use a user-defined function or type | Yes | No; built-ins only, including transitively via operators and casts |
| Written to `pg_attribute.attgenerated` | `'s'` | `'v'` |
| Backfilled by an `ALTER TABLE ADD COLUMN` rewrite | Yes | No; there is nothing to store |
| Consequence for `satus` sampling | Compute and check against downstream indexes and FKs the same as any other column | Compute the value client-side to reason about downstream CHECKs; the column itself cannot be indexed or referenced |

The user-defined-type and built-in-only restrictions are in the [PostgreSQL 18 DDL reference](https://www.postgresql.org/docs/18/ddl-generated-columns.html). The rejection messages for indexes, unique constraints, primary keys, and foreign keys on virtual generated columns are enforced by the Postgres source (`src/backend/commands/indexcmds.c` and `src/backend/commands/tablecmds.c`) in the initial PG18 release. That means a schema that wants "join on the computed value" needs either a `STORED` generated column, or an expression index and a shadow column that a `FOREIGN KEY` can point at; the two options are schema decisions, not seeder decisions. The point of naming them here is that a schema which was `GENERATED ALWAYS AS (…) STORED` under PG12–17 and re-declared without the keyword under PG18 will look different in the catalog and will fail differently at DDL time.

## Why "load-bearing now"

Three shifts pushed generated columns from a curiosity into infrastructure between PG12 and PG18:

1. **Full-text search vectors moved out of triggers.** The pattern `tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || body)) STORED` replaced the classic before-insert trigger that maintained a `tsvector` column by hand. The replacement is smaller, correct across `UPDATE`s without a second trigger, and indexable by GIN in the same statement.
2. **Money and quantity totals moved out of the application.** `line_total_cents integer GENERATED ALWAYS AS (quantity * unit_price_cents) STORED`, with a `CHECK (line_total_cents >= 0)` alongside, encodes "the total is the product" as a schema invariant instead of a convention the ORM has to remember. See [Check constraints that lie](/blog/check-constraints-that-lie) for how those CHECKs interact with the generated value.
3. **Normalized keys stopped needing a maintenance job.** `email_lower citext GENERATED ALWAYS AS (lower(email)) STORED` with a `UNIQUE (email_lower)` gives you a case-insensitive uniqueness constraint that never drifts. [The citext trap](/blog/the-citext-trap) is the longer treatment of why teams prefer this to `citext` on the raw column.

Each of those idioms is documented in the PostgreSQL manual and in shipping application schemas. Our own [audit corpus](/blog/ecommerce-profile), which pins five open-source schemas to mature releases from before those idioms were widespread, currently records zero generated columns across 1,095 columns; that count will move as we add newer schemas to `corpus/sources.json`. The point of naming the number is honesty about scope: this post describes the mechanics the catalog encodes, not a survey of adoption rates.

## Reading them out of the catalog

The one field that matters is `pg_attribute.attgenerated`. It is `''` (empty) for a regular column, `'s'` for a stored generated column, and `'v'` for a virtual generated column. The expression itself is not stored in `pg_attribute`; it lives in `pg_attrdef.adbin` and is resolved to text with `pg_get_expr(adbin, adrelid)`. The idiomatic query, and the one satus runs at planning time:

```sql
SELECT
  a.attname,
  format_type(a.atttypid, a.atttypmod) AS type,
  a.attgenerated,                                      -- '' | 's' | 'v'
  pg_get_expr(ad.adbin, ad.adrelid) AS generation_expr
FROM pg_attribute a
LEFT JOIN pg_attrdef ad
  ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE a.attrelid = $1::regclass
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum;
```

Two properties fall out of this that a tool needs to respect:

- **`INSERT` never mentions the column.** [`INSERT`](https://www.postgresql.org/docs/current/sql-insert.html) rejects any non-`DEFAULT` value in the column list for a generated column. The seeder therefore either omits the column entirely from the `INSERT` (preferred, since it also survives future changes to the column list) or writes `DEFAULT`. `COPY` obeys the same rule.
- **The expression may only reference the current row.** The [restriction list](https://www.postgresql.org/docs/current/ddl-generated-columns.html) is unambiguous: no subqueries, no other tables, no other generated columns, no system columns except `tableoid`, immutable functions only, and, for virtual columns, built-in functions and types only. That means the value can always be computed by the client from the values the client already generated for the underlying columns, without a round-trip. `satus` does exactly that so it can reason about any downstream constraint the generated value participates in.

## The three places a naive seeder gets it wrong

Even after you skip the column at `INSERT` time, three downstream cases stay live:

1. **A `UNIQUE` on the generated column.** If `email_lower GENERATED ALWAYS AS (lower(email)) STORED` is `UNIQUE`, the seeder cannot pick two `email` values that collapse to the same lowercase form. The uniqueness constraint is on the computed value, not on `email`, so a corpus that samples `Alice@x.com` and `alice@X.com` will fail on the second insert with a duplicate-key error that mentions a column the seeder never wrote to. Detection is mechanical: any `UNIQUE` whose column list contains a generated column becomes a uniqueness constraint over the composition of the generation expression and the underlying column profile.
2. **A `CHECK` that references the generated column.** `CHECK (line_total_cents >= 0)` on a table with `line_total_cents GENERATED ALWAYS AS (quantity * unit_price_cents) STORED` is really a constraint on `quantity * unit_price_cents`, not on a column the client picks. If the seeder samples `quantity < 0` because the underlying `CHECK` says so and separately samples `unit_price_cents < 0` because pricing looks free-form, the product can be positive and the constraint passes for reasons the schema author did not intend. Reading the generation expression back through the constraint expression is how you find the joint constraint that actually applies. This is the same class of problem covered in the fourth section of [Check constraints that lie](/blog/check-constraints-that-lie), applied to a computed column instead of a stored one.
3. **A foreign key that points at (or from) a generated column.** For `STORED` generated columns, `FOREIGN KEY` is permitted, and the child column has to end up equal to a value the parent's generation expression can produce. That is a strictly harder sampling problem than an FK on a regular column, because the child's value space is defined by an expression, not by the set of `INSERT`s. `satus` handles it by generating the parent first (the normal FK order) and then sampling child values from the observed parent computed values, or, if the parent is empty, sampling underlying parent columns such that the computed value is drawn from the intended distribution. On PG18, `FOREIGN KEY` constraints on virtual generated columns are rejected at DDL time, so any schema that needs an FK on a computed value keeps it stored.

## A worked example

Consider a small `orders` table that uses one generated column of each shape you actually see in the wild:

```sql
CREATE TABLE orders (
  id                bigserial PRIMARY KEY,
  customer_id       bigint NOT NULL REFERENCES customers(id),
  quantity          integer NOT NULL CHECK (quantity > 0),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents  integer GENERATED ALWAYS AS
                      (quantity * unit_price_cents) STORED,
  email             text   NOT NULL,
  email_lower       text   GENERATED ALWAYS AS (lower(email)) STORED,
  UNIQUE (email_lower),
  CHECK (line_total_cents >= 0)
);
```

`satus plan --schema public` for this table prints, in the same format used elsewhere in the CLI:

```text
table public.orders
  columns:
    id                 bigint         [pk, serial]
    customer_id        bigint         [fk -> customers.id]
    quantity           integer        [check: quantity > 0]
    unit_price_cents   integer        [check: unit_price_cents >= 0]
    line_total_cents   integer        [GENERATED STORED: quantity *
                                       unit_price_cents]
    email              text
    email_lower        text           [GENERATED STORED: lower(email)]
                                      [unique]

  sampling plan:
    line_total_cents   computed from quantity and unit_price_cents;
                       downstream CHECK (line_total_cents >= 0) is
                       satisfied by the underlying column constraints.
    email_lower        computed from email; UNIQUE (email_lower)
                       enforced by sampling email from a case-folded
                       pool so no two rows collide after lower().

  INSERT plan:
    columns written: (customer_id, quantity, unit_price_cents, email)
    line_total_cents and email_lower are omitted; Postgres will
    compute them.
```

Two things about this output are worth naming. The `INSERT` column list is a strict subset of `pg_attribute`, and that subset is a function of `attgenerated`, not of the profile. And the `UNIQUE (email_lower)` line is what stops the seeder from picking `Alice@x.com` and `alice@X.com` as two different rows; without it, the fixture would insert cleanly against a schema that had never seen the constraint and fail against the real one on the first duplicate.

## Two anti-patterns we see recently

The support tickets that involve generated columns cluster into two shapes.

**"The column disappeared after we upgraded to PG18."** It didn't. What happened is that the team wrote `GENERATED ALWAYS AS (…)` without the `STORED` keyword, which was a parse error under PG12–17 (where `STORED` was mandatory) and now defaults to `VIRTUAL`. Column reads still work; a `FOREIGN KEY`, `UNIQUE`, or index on that column is rejected at DDL time under the messages quoted in the table above. The fix is to write the keyword out: `GENERATED ALWAYS AS (…) STORED` if you meant stored, `GENERATED ALWAYS AS (…) VIRTUAL` if you meant virtual. The [PG18 release notes](https://www.postgresql.org/docs/release/18.0/) describe the change under Utility Commands; the fix is a schema decision, not a tooling one.

**"Our seed data is wrong and we can't find where."** This one is almost always a stored generated column that participates in a constraint the seeder is ignoring. The symptom is that the row inserts but a downstream query is off by a factor: `SUM(line_total_cents)` matches production, `AVG(quantity * unit_price_cents)` does not, because the underlying `quantity` distribution the seeder chose has a different shape than production even though it satisfies every constraint it can see. The fix is not the seeder; the fix is a [distribution](/blog/picking-distributions-not-values) for the underlying column that reproduces the computed distribution the reports depend on. Generated columns make the "sample the shape, not the value" argument concrete: if the schema computes the total from the parts, the parts are the thing you have to profile.

## The shorter version

Generated columns in Postgres are computed by the database from the row you write, not by the client. The observable rule is that `INSERT` cannot supply a value; the deeper rule is that the value participates in every downstream `UNIQUE`, `CHECK`, index, and (for stored columns) foreign key exactly as if the client had computed and written it. A seeder that reads `pg_attribute.attgenerated` and reasons about the composed constraints produces rows the database accepts on the first try. A seeder that treats the column as ordinary produces the error that reads, out of context, like a Postgres bug: a duplicate-key on a column nobody wrote, a check-constraint failure on a column nobody chose. Neither is a bug. The catalog told you the answer; the seeder had to read it.

If you have not looked at `attgenerated` in your own schema recently, [`satus plan`](/quickstart) will surface every generated column, its expression, and every downstream constraint whose value space now depends on that expression. The [/profiles](/profiles) page lists which built-in profiles already know about the common shapes (`tsvector` search columns, computed totals, case-folded uniqueness).

## References

- PostgreSQL documentation, [Generated Columns (current)](https://www.postgresql.org/docs/current/ddl-generated-columns.html).
- PostgreSQL documentation, [Generated Columns in 12](https://www.postgresql.org/docs/12/ddl-generated-columns.html) and [in 18](https://www.postgresql.org/docs/18/ddl-generated-columns.html).
- PostgreSQL documentation, [`INSERT`](https://www.postgresql.org/docs/current/sql-insert.html).
- PostgreSQL documentation, [`pg_attribute`](https://www.postgresql.org/docs/current/catalog-pg-attribute.html) and [`pg_attrdef`](https://www.postgresql.org/docs/current/catalog-pg-attrdef.html).
- PostgreSQL release notes, [18.0](https://www.postgresql.org/docs/release/18.0/).
