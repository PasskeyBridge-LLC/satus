---
slug: information-schema-is-privilege-filtered
title: information_schema is privilege-filtered, and it made our CI gate lie
seoTitle: information_schema is privilege-filtered: our CI gate lied
description: A role with SELECT on every table still sees zero constraints in information_schema. Measured on PostgreSQL 16.13, with the bug it exposed in our dry-run gate.
date: 2026-08-21
author: satus.sh
tags: [postgres, catalogs, introspection, privileges, ci]
draft: false
---

`satus generate --dry-run` exists to be a CI gate. It plans a run, simulates the rows, validates them against your live schema metadata, and exits `2` if it finds anything wrong. We tell people to wire it into CI and gate migrations on it.

While writing what was supposed to be a post about collapsing catalog introspection into one query, we pointed the shipped v0.3.10 binary at a schema with a guaranteed validation error and gave the CLI a read-only database role. It exited `0`.

```text
  simulating + validating...
  currencies . (dry-run)

  ✓ no validation findings across 1 tables
EXIT=0
```

The schema was wrong. The gate said it was fine. What follows is why, and it is not a Postgres bug: it is documented behaviour we read past.

Everything below was measured on PostgreSQL 16.13, not reasoned about from the docs.

## What a seeder needs from the catalog

Before satus writes a row it has to know four things about every table: its columns, its primary key, its single-column unique constraints, and its foreign keys. The foreign keys are the load-bearing ones, because they determine insertion order. Get the FK graph wrong and you insert a child before its parent, and Postgres rejects the row.

The obvious place to ask is `information_schema`. It is in the SQL standard, it is portable, and it is what most tutorials reach for.

## Three roles, one schema

Here is the test schema. Three tables, two foreign keys, three primary keys, two unique constraints.

```sql
create table orgs (
  id   integer generated always as identity primary key,
  slug text not null unique,
  name text not null
);
create table users (
  id     integer generated always as identity primary key,
  org_id integer not null references orgs(id),
  email  text not null unique,
  name   text not null
);
create table posts (
  id        integer generated always as identity primary key,
  author_id integer not null references users(id),
  title     text not null
);

create role ci_readonly;
create role seeder;
grant usage on schema public to ci_readonly, seeder;
grant select         on all tables in schema public to ci_readonly;
grant select, insert on all tables in schema public to seeder;
```

`ci_readonly` can read every table in the schema. Nothing is hidden from it at the data level. Asking each catalog how many foreign-key rows it can see:

```text
                   source                   | fk_rows
--------------------------------------------+---------
 information_schema.table_constraints       |       0
 information_schema.referential_constraints |       0
 information_schema.constraint_column_usage |       0
 information_schema.key_column_usage        |       7
 pg_catalog.pg_constraint (contype=f)       |       2
```

Three of the four `information_schema` views return nothing. The catalog returns both foreign keys. `key_column_usage` returns seven rows, which is every constrained column in the schema, and is the outlier worth explaining.

Note what did not happen: no error, no permission denied, no warning. The views are readable. They are simply empty.

## The predicates

`pg_get_viewdef` on a live server gives the actual filter. The `WHERE` clause of `information_schema.table_constraints` ends like this:

```sql
AND (pg_has_role(r.relowner, 'USAGE'::text)
     OR has_table_privilege(r.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'::text)
     OR has_any_column_privilege(r.oid, 'INSERT, UPDATE, REFERENCES'::text))
```

`SELECT` is not in that list. It is not an oversight in our reading; the PostgreSQL documentation says so in one sentence: `table_constraints` "contains all constraints belonging to tables that the current user owns or has some privilege other than SELECT on" ([table_constraints](https://www.postgresql.org/docs/current/infoschema-table-constraints.html)).

`referential_constraints` carries the same predicate, and its documentation matches: only constraints "for which the current user has write access to the referencing table (by way of being the owner or having some privilege other than SELECT)" ([referential_constraints](https://www.postgresql.org/docs/current/infoschema-referential-constraints.html)).

`constraint_column_usage` is stricter still. Its entire filter is one call:

```sql
WHERE pg_has_role(tblowner, 'USAGE'::text);
```

Ownership, or membership in the owning role. No grant of any kind makes this view visible, which the documentation states directly: only columns "contained in a table owned by a currently enabled role" are shown ([constraint_column_usage](https://www.postgresql.org/docs/current/infoschema-constraint-column-usage.html)). We confirmed this by granting `SELECT` on both the child and the parent table and re-running. It still returned zero rows.

That matters because `constraint_column_usage` is the view that tells you what a foreign key *points at*. It is the natural place to look, and it is the one view no grant can unlock.

`key_column_usage` is the exception, and its predicate says why:

```sql
AND (pg_has_role(ss.relowner, 'USAGE'::text)
     OR has_column_privilege(ss.roid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES'::text));
```

`SELECT` is present. So a read-only role learns that `users.org_id` participates in a constraint called `users_org_id_fkey`, but cannot learn from `table_constraints` that it is a foreign key, or from `constraint_column_usage` what it references. That is arguably worse than seeing nothing, because a naive introspector reads a constraint that appears to have no target.

| View | Owner | SELECT only | INSERT etc. |
|---|---|---|---|
| `table_constraints` | yes | **no** | yes |
| `referential_constraints` | yes | **no** | yes |
| `constraint_column_usage` | yes | **no** | **no** |
| `key_column_usage` | yes | yes | yes |
| `pg_catalog.pg_constraint` | yes | yes | yes |

## The bug this found in our own code

satus has read foreign keys from `pg_catalog` since v0.2.0, and the comment above the query has said why since the day it was written. Here is that comment, in the shipped v0.3.10 source:

```text
// FK introspection deliberately uses pg_catalog rather than
// information_schema.constraint_column_usage, which is
// privilege-filtered: a role that can read the table but not the
// parent table sees zero FK rows, silently breaking the topo sort.
```

Correct, and applied to exactly one of the five CTEs in that query. The primary-key and unique-constraint lookups still went through `information_schema.table_constraints`. Running the shipped query under each of the three roles:

```text
--- as postgres ---
tables:  3   columns: 10
pks:     3   ["orgs.id","posts.id","users.id"]
uniques: 2   ["orgs.slug","users.email"]
fks:     2   ["posts.author_id -> users.id","users.org_id -> orgs.id"]

--- as seeder ---
tables:  3   columns: 10
pks:     3   ["orgs.id","posts.id","users.id"]
uniques: 2   ["orgs.slug","users.email"]
fks:     2   ["posts.author_id -> users.id","users.org_id -> orgs.id"]

--- as ci_readonly ---
tables:  3   columns: 10
pks:     0   []
uniques: 0   []
fks:     2   ["posts.author_id -> users.id","users.org_id -> orgs.id"]
```

The foreign keys survive, because we fixed that path. The primary keys and unique constraints do not. Columns survive too, because `information_schema.columns` filters on column privilege and `SELECT` counts there.

The `seeder` row explains why nobody hit this. A role that can actually seed needs `INSERT`, and `INSERT` satisfies the `table_constraints` predicate. Every ordinary `satus generate` run was fine. The affected path is the one where a role legitimately holds only `SELECT`, which is precisely the role you would hand a CI job that only ever runs `--dry-run`. We recommend that. We built the gate that way. Then we shipped a query that quietly degrades under it.

## The false green

`uniqueColumns` is what gates the `unique_duplicate` finding in the validator. When it arrives empty, the check does not fail, it does not run.

The demonstration needs a schema where the dry-run should fail. A `varchar(4)` unique column does it, because the simulator caps synthesized strings at `maxLength` and four distinct values collapse into one:

```sql
create table currencies (
  id   integer generated always as identity primary key,
  code varchar(4) not null unique,
  name text not null
);
```

Shipped v0.3.10, as `ci_readonly`:

```text
  ✓ no validation findings across 1 tables
EXIT=0
```

The same command, same role, after the fix:

```text
  findings: 4 error / 0 warn
  error currencies.code                      unique_duplicate   x4  rows[1,2,3+]
         Duplicate value in UNIQUE column "code" within the same batch
EXIT=2
```

A CI gate that returns a false green is worse than no gate, because a missing gate is visible and a lying one is not.

**If you are affected.** Every published version through v0.3.10 has this behaviour. It only bites when the role in `DATABASE_URL` holds `SELECT` and no write privilege on the tables being planned, which in practice means a dedicated read-only CI credential. A run that seeds for real is unaffected, because it needs `INSERT` and `INSERT` satisfies the predicate. Until the fix is published, run the gate as a role that owns the tables or holds a write privilege on them, and it reports correctly. You can check which case you are in directly:

```sql
select count(*) from information_schema.table_constraints
where table_schema = 'public';
```

Zero, against a schema that has constraints, means your role is in the affected set. The fix is on `main` and goes out in the next release.

The fix moves `v_pks` and `v_uniques` onto `pg_constraint`, alongside the FK lookup that was already there. Primary-key column order comes from `unnest(con.conkey) with ordinality` rather than `key_column_usage.ordinal_position`, and single-column uniques are selected with `cardinality(con.conkey) = 1`, which preserves the existing v0.x limitation exactly: `UNIQUE` constraints are seen, bare `CREATE UNIQUE INDEX` is not.

Five regression tests now assert that `v_pks`, `v_uniques`, and `v_fks_raw` contain no reference to `information_schema`, that `v_columns` still does, and that the cardinality filter survives. We mutation-tested them by reverting the CTE and confirming the suite goes red.

## While we were in there: the round-trip claim

The post this was supposed to be was about that query being one round-trip instead of five. That change is real and shipped in v0.2.0, where we [measured it against pooled Supabase](/blog/v0-2-0-deferred-constraints-faster-planning-smaller-binary) and saw wire time fall from 378 ms to 43 ms.

The comment in the source, though, claimed the batching was also a small win on a local socket. That is false, and measuring it properly was overdue. Median of 250 interleaved runs over loopback TCP:

```text
                        3 tables / 10 cols   70 tables / 488 cols
  one CTE query              10.62 ms              22.16 ms
  five queries                6.38 ms              17.23 ms
  extra server work           4.24 ms               4.93 ms
```

The `jsonb_agg` wrapping costs roughly 4 to 5 ms regardless of schema size, and a loopback round-trip measures about 0.09 ms. Four saved round-trips save 0.37 ms against 4.24 ms of added work. Batching only pays once round-trip time exceeds the break-even, which came out at 1.06 ms on the small schema and 1.23 ms on the large one.

That threshold is low enough that every managed Postgres clears it comfortably, which is why the v0.2.0 measurement against Supabase looked so good and why we are keeping the design. But against a local server the single query is the slower one, and the source comment now says so with the numbers attached.

## Partitions, briefly

The same query carries one more catalog-only trick. A partitioned parent has `relkind='p'` and its children have `relispartition=true`. Postgres routes inserts on the parent to the right partition, so satus seeds the parent and skips the children. But foreign keys are often declared per-partition, which makes a naive read see the parent as FK-free and sort it to the front. The query calls [`pg_partition_root`](https://www.postgresql.org/docs/current/ddl-partitioning.html) to re-attribute a child's FK back to the topmost ancestor, then collapses the duplicates that inherited constraints create. Verified on a partitioned table with a two-column primary key: parent reported once, children excluded, key order preserved.

## What we are not claiming

This is not an argument that `information_schema` is bad. It is portable, it is standardized, and its privilege filtering is deliberate: the standard's position is that you should not learn about constraints on tables you have no business writing to. If you are writing portable SQL across engines, it remains the right surface.

It is an argument that a schema-introspection tool is the wrong consumer for it. satus runs against one engine, needs a complete picture, and cannot afford metadata that silently thins out based on the connecting role. The [system catalogs](https://www.postgresql.org/docs/current/catalogs.html) are versioned with the server, documented, and unfiltered.

The v0.x limits are unchanged by any of this: multi-column `UNIQUE` constraints are still not enforced during generation, cross-column arithmetic is still not reconciled, and there is still no `--seed`, so output is not deterministic between runs.

## Sources

- [PostgreSQL: `table_constraints`](https://www.postgresql.org/docs/current/infoschema-table-constraints.html)
- [PostgreSQL: `referential_constraints`](https://www.postgresql.org/docs/current/infoschema-referential-constraints.html)
- [PostgreSQL: `constraint_column_usage`](https://www.postgresql.org/docs/current/infoschema-constraint-column-usage.html)
- [PostgreSQL: `key_column_usage`](https://www.postgresql.org/docs/current/infoschema-key-column-usage.html)
- [PostgreSQL: The Information Schema](https://www.postgresql.org/docs/current/information-schema.html)
- [PostgreSQL: `pg_constraint`](https://www.postgresql.org/docs/current/catalog-pg-constraint.html)
- [PostgreSQL: System Catalogs](https://www.postgresql.org/docs/current/catalogs.html)
- [PostgreSQL: Privilege inquiry functions](https://www.postgresql.org/docs/current/functions-info.html)
- [PostgreSQL: Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)

Earlier posts on the same surface: [what `pg_dump` doesn't tell you](/blog/what-pg-dump-doesnt-tell-you) and [the schema I couldn't reproduce](/blog/the-schema-i-couldnt-reproduce).
