---
slug: check-constraints-that-lie
title: "Check constraints that lie"
description: Postgres CHECK constraints often encode wishes. Where they leak (NULL, non-immutable expressions, NOT VALID, domains) and what to write instead.
date: 2026-06-17
author: satus.sh
tags: [postgres, constraints, schema, seeding]
draft: false
---

A `CHECK` constraint in Postgres looks like a rule. Half the time it is a rule. The other half it is a wish the schema author wrote down once and that the database has been quietly not enforcing ever since. For a tool like [satus](/) that has to generate rows the schema will accept on the first try, the difference matters: a constraint that the database treats as advisory is one the seeder can ignore, and a constraint that the database enforces is one the seeder has to plan around. This post is the field guide to the four ways a `CHECK` lies, the one way it cannot, and how the CLI sorts them at planning time.

The behaviours below are all documented in [PostgreSQL's CREATE TABLE reference](https://www.postgresql.org/docs/current/sql-createtable.html) and the [CHECK constraint section of "Data Definition"](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS); none of this is a Postgres bug. The bug, when it exists, is the gap between what the author thought they had written and what Postgres agreed to enforce.

## The short version, for the planner-stats reader

Postgres evaluates a `CHECK` expression per row at INSERT or UPDATE time and rejects the row if the result is `FALSE`. It accepts the row if the result is `TRUE` or `NULL`. It does not re-evaluate the expression later, it does not run the expression against existing rows when a `NOT VALID` constraint is added, and it does not stop you from putting a function in there that returns a different answer the next time you call it. Each of those choices is reasonable in isolation. Together they make `CHECK` the constraint most likely to silently disagree with the application that depends on it.

## Lie #1: the constraint that ignores NULL

`CHECK (x > 0)` does not reject rows where `x` is `NULL`. It evaluates to `NULL`, and Postgres treats a `NULL` result as "not false", which is "accept". This is the documented behaviour of SQL three-valued logic; it is also the single most common way a `CHECK` constraint encodes a rule the database is not enforcing.

A concrete example from the wild. In the schemas we audit for our corpus (see [Inside the e-commerce profile](/blog/ecommerce-profile) for the methodology), the only schema that ships more than one `CHECK` is PowerDNS's gpgsqlbackend, which puts a [`c_lowercase_name CHECK ((name)::TEXT = LOWER((name)::TEXT))`](https://github.com/PowerDNS/pdns/blob/auth-4.9.3/modules/gpgsqlbackend/schema.pgsql.sql) on four tables. Two of those tables declare `name VARCHAR(255) NOT NULL`; the CHECK is real on those rows. The other two declare `name VARCHAR(255)` or `name VARCHAR(255) DEFAULT NULL`; the CHECK passes silently whenever `name` is `NULL`, which is exactly when the lowercase rule cannot apply. The constraint is correct as written and almost certainly does what the author intended. It is also a useful demonstration that the same one-line `CHECK`, copy-pasted across four tables, is enforced on two of them and advisory on the other two.

For seed-data generation the rule is mechanical. If a column is nullable and the `CHECK` would be `NULL`-tolerant, `satus` is free to emit `NULL`; the constraint contributes nothing to the value space and the planner stats will reflect whatever `frac_null` the column profile dictates ([NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question) is the longer treatment of how we pick that fraction). If the column is `NOT NULL`, the `CHECK` becomes load-bearing and we have to solve for it.

If you want the rule "name must be lowercase, and must also be present", the correct form is two constraints, not one:

```sql
ALTER TABLE domains
  ALTER COLUMN name SET NOT NULL,
  ADD CONSTRAINT name_lowercase
    CHECK (name = LOWER(name));
```

Or, if you prefer a single expression, write the `NULL` case explicitly:

```sql
CHECK (name IS NOT NULL AND name = LOWER(name))
```

The two forms are equivalent at the row level. The first is easier to introspect; tools like `satus` can read the `NOT NULL` bit and the `CHECK` bit independently and reason about them separately, which is the same reason `\d` prints them separately.

## Lie #2: the constraint with a non-immutable expression

Postgres lets you put a non-immutable function inside a `CHECK`. It will warn about volatile functions in some contexts and silently accept stable ones, but the underlying property is that the constraint is evaluated once at INSERT or UPDATE time and never again. That is fine for `CHECK (created_at <= now())`, where the constraint is a sanity check at write time and any later drift is harmless. It is a serious problem for `CHECK (expires_at > now())`, which an author writes meaning "this row must always be in the future" and which the database enforces meaning "this row must have been in the future at the moment it was written".

The damage shows up in three places. Reports built on `WHERE expires_at > now()` and a separately-maintained `WHERE NOT expired` flag disagree, because the flag updates on a job and the CHECK does not. Materialised views or partial indexes built on the same expression are correct on insert and drift afterwards. A `pg_dump` and restore can fail when the dump reloads rows that were valid when written but whose `expires_at` has since passed; in older Postgres versions and in some failure modes this still surfaces as a confusing restore error. The PostgreSQL manual is unambiguous about the cause: "PostgreSQL does not support CHECK constraints that reference table data other than the new or updated row being checked" ([CHECK Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS)), and `now()` is read-table data in disguise.

For seeding, satus treats any `CHECK` whose expression references `now()`, `current_date`, `current_timestamp`, `clock_timestamp()`, `transaction_timestamp()`, `statement_timestamp()`, `random()`, or a `VOLATILE` user-defined function as satisfiable-at-write-time and nothing more. We produce a row that will pass the CHECK at the moment of insertion; we also emit a planner-time warning that the constraint is not a long-term invariant. The warning is the point. A user who sees `expires_at > now()` and wants a rule that holds forever needs either an application-side enforcement, a trigger that recomputes on read, or an explicit `EXCLUDE` constraint on a time range, none of which a `CHECK` will give them.

## Lie #3: the NOT VALID constraint

`ALTER TABLE ... ADD CONSTRAINT ... CHECK (...) NOT VALID` adds a constraint without scanning existing rows ([ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)). New writes are checked; old rows are grandfathered in until somebody runs `ALTER TABLE ... VALIDATE CONSTRAINT`. This is a deliberately useful feature: large tables can adopt a new rule without a long, locking scan, and the validate step can be run later in a smaller, off-peak window.

The lie is in what people forget to run the validate step. We have seen production schemas where a constraint has been `NOT VALID` for years, the team has long since stopped thinking of it as conditional, and a quarter of the rows in the table do not satisfy it. Application code that assumes the constraint holds runs into the unvalidated rows the first time somebody widens a query. Seed-data tools that try to reproduce production land in the same trap: if you generate rows that look like the average of production, half of them will satisfy a constraint that half of production does not.

`satus` reads the `convalidated` column of `pg_constraint` and treats `NOT VALID` constraints as live for the rows we generate; we obey them. We also surface them in the plan output as a separate category, because a constraint that production does not yet satisfy is a constraint the user should know about before they ask why their fixture is "cleaner" than their database. The relevant `pg_catalog` field is documented in the [system catalogs reference](https://www.postgresql.org/docs/current/catalog-pg-constraint.html); we do not infer it, we read it.

## Lie #4: the domain constraint that disappears

Postgres lets you define a `DOMAIN` with its own `CHECK`, then use that domain as a column type. The constraint moves from `pg_constraint` (where most tools look) to `pg_type` / `pg_constraint` linked through `pg_constraint.contypid`. Tools that introspect a table by scanning `pg_constraint WHERE conrelid = <table>` miss it entirely. The constraint is fully enforced; it just is not where most introspection code looks for it.

Pagila's schema is a small but clean example. It declares [`CREATE DOMAIN public.year AS integer CONSTRAINT year_check CHECK (VALUE >= 1901 AND VALUE <= 2155)`](https://github.com/devrimgunduz/pagila/blob/master/pagila-schema.sql) and uses `year` as the type of `film.release_year`. A naive introspector reports zero CHECK constraints on `film`. A correct one reports one, sourced from the domain, with `VALUE` as the placeholder for the column.

`satus` handles domains by walking the type chain at planning time: for every column, we resolve the base type, collect any `CHECK` defined on intermediate domains, and treat them as if they were defined inline on the column. The behaviour is described in [PostgreSQL's CREATE DOMAIN reference](https://www.postgresql.org/docs/current/sql-createdomain.html). For Pagila's `release_year` we sample uniformly in `[1901, 2155]` and warn the user that their year column has a hard upper bound just over a century out, which is one of those facts that is fine until 2156.

## The one CHECK that cannot lie: arithmetic on the new row

The reason `CHECK` exists in the first place is the case where it cannot lie. An expression that references only the row being written, uses only immutable operators and functions, and is not `NULL`-tolerant in a way the author did not intend, is a proper constraint. Postgres enforces it on every write, the planner can use it to prove things about the column (`CHECK (x > 0)` lets the planner avoid scanning negative-x partitions), and `pg_dump` round-trips it without surprises. The canonical examples are the boring ones:

```sql
-- arithmetic invariants
CHECK (quantity > 0)
CHECK (start_at < end_at)
CHECK (line_total_cents = quantity * unit_price_cents)

-- enum-shaped TEXT columns
CHECK (status IN ('placed','paid','fulfilled','refunded','cancelled'))

-- format invariants (immutable, NULL-tolerant in a deliberate way)
CHECK (email IS NULL OR email ~ '^[^@]+@[^@]+\.[^@]+$')
```

These satus enforces by construction: we sample inside the allowed value space rather than rejecting outside it, so the seeder never produces a row that violates them. The plan output lists each one under "honoured by sampling" so the user can see at a glance which constraints are doing work in the fixture.

## How the planner sorts CHECKs

Concretely, for every `CHECK` we find on a target table, the planner classifies it into one of four buckets:

| Bucket | Detection | What satus does |
| --- | --- | --- |
| Honoured by sampling | Immutable expression over the new row, not `NULL`-tolerant in a way that matters for this column | Constrain the sampler so generated values satisfy the predicate |
| `NULL`-tolerant on a nullable column | Expression evaluates to `NULL` whenever the column is `NULL`, and the column is nullable | Ignore the CHECK; sample the column independently from its profile |
| Satisfiable-at-write-time only | Expression references `now()`, `random()`, a volatile UDF, or any non-immutable function | Generate a row that passes at insertion; warn that the CHECK is not a long-term invariant |
| `NOT VALID` | `pg_constraint.convalidated = false` | Honour the CHECK for generated rows; surface separately in plan output |

The `NULL`-tolerant case is the one most often miscategorised by hand-rolled tooling. The cleanest rule is the one Postgres itself uses: if every column referenced in the CHECK is `NULL` for the candidate row and the expression returns `NULL`, the row passes. We test this at planning time by substituting `NULL` for each referenced column in turn and inspecting the result via `EXPLAIN` of a one-row SELECT; that gives us a deterministic classification without a custom expression evaluator.

## What this looks like in practice

A short worked example. Suppose your schema has:

```sql
CREATE TABLE coupons (
  id          bigserial PRIMARY KEY,
  code        text,
  discount    numeric(5,2),
  expires_at  timestamptz,
  CHECK (code = LOWER(code)),
  CHECK (discount > 0),
  CHECK (expires_at > now())
);
```

`satus plan --schema public` prints:

```text
table public.coupons
  CHECK (code = LOWER(code))           [NULL-tolerant; code is nullable]
  CHECK (discount > 0)                 [NULL-tolerant; discount is nullable]
  CHECK (expires_at > now())           [satisfiable-at-write-time only]

warnings:
  coupons.expires_at: CHECK references now(); generated rows will be in
    the future at insertion time but the constraint is not a long-term
    invariant. Consider an application-side check or a partial index.
```

None of the three constraints constrain the sampler. The first two are advisory because the columns are nullable; the third is advisory because the expression is non-immutable. The generated fixture is valid Postgres rows that pass every constraint at insert time, and the warnings tell the user that two of those three constraints are not buying them what the source code reads as if they were.

If the same table were declared with the columns `NOT NULL` and the third constraint replaced with a partial index `WHERE expires_at > now()` on the relevant query, the plan output would shrink to one bucket (honoured by sampling) and zero warnings, which is the desired end state.

## The shorter version

CHECK constraints in Postgres are evaluated per row, at write time, against `TRUE`-or-not-`FALSE` semantics. Most of the time that matches what the author meant. Some of the time it does not, and the constraint silently accepts rows that violate the stated rule because the column is `NULL`, the expression depends on the current time, the constraint was added `NOT VALID` and never validated, or the constraint lives on a domain and the introspector never looked. A seed-data tool that wants to produce rows the database will accept on the first try has to read each of those cases out of the catalogs explicitly, classify the constraint, and tell the user when a constraint they wrote is not being enforced.

If you have not looked at the `CHECK` constraints in your own schema for a while, `satus plan` is a fast way to find out which of them are actually doing work and which are decoration. The [/quickstart](/quickstart) covers pointing it at your database; the [/profiles](/profiles) page lists what each built-in profile already knows about CHECK-heavy domains.

## References

- PostgreSQL documentation, [CHECK Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS).
- PostgreSQL documentation, [CREATE TABLE](https://www.postgresql.org/docs/current/sql-createtable.html).
- PostgreSQL documentation, [ALTER TABLE — `NOT VALID` and `VALIDATE CONSTRAINT`](https://www.postgresql.org/docs/current/sql-altertable.html).
- PostgreSQL documentation, [CREATE DOMAIN](https://www.postgresql.org/docs/current/sql-createdomain.html).
- PostgreSQL documentation, [`pg_constraint`](https://www.postgresql.org/docs/current/catalog-pg-constraint.html).
- PowerDNS gpgsqlbackend schema, [`schema.pgsql.sql` at `auth-4.9.3`](https://github.com/PowerDNS/pdns/blob/auth-4.9.3/modules/gpgsqlbackend/schema.pgsql.sql).
- Pagila sample database, [`pagila-schema.sql`](https://github.com/devrimgunduz/pagila/blob/master/pagila-schema.sql).
