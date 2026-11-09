---
slug: multi-column-uniques-why-v0x-skips-them
title: Multi-column uniques, and why satus v0.x skips them
description: satus 0.3.11 unique-column checks read single-column UNIQUE constraints. Multi-column constraints and bare unique indexes are skipped on purpose.
date: 2026-10-30
publishAt: 2026-10-30T09:00:00-04:00
author: satus.sh
tags: [seeding, postgres, constraints, unique]
draft: false
---

For its unique-column checks, `@passkeybridge/satus@0.3.11` reads single-column `UNIQUE` constraints. Primary keys are read by a separate catalog query and are what foreign keys attach to. A `unique (workspace_id, email)` is skipped, and so is any uniqueness declared with `create unique index` instead of a constraint. The [README at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/README.md) lists the multi-column gap under "Honest limits (v0.x)". The index gap is in a comment in the introspection query.

`@passkeybridge/satus@0.3.12` is the current npm release. The transcripts were re-run on 2026-11-06 with that binary against PostgreSQL 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), `psql` 17.11, and Node v24.21.0, with no provider key. `DATABASE_URL` is `postgresql://postgres:postgres@127.0.0.1:5433/uniq_dev`. The unique-column query linked below is the v0.3.11 source.

## The schema

Three tables, each declaring uniqueness a different way:

```sql
create table workspaces (
  id   integer generated always as identity primary key,
  name text not null
);

create table members (
  id           integer generated always as identity primary key,
  workspace_id integer not null references workspaces(id),
  email        text not null,
  role         text not null,
  constraint members_workspace_email_key unique (workspace_id, email)
);

create table api_keys (
  id     integer generated always as identity primary key,
  label  text not null
);
create unique index api_keys_label_lower_idx on api_keys (lower(label));
create unique index api_keys_label_idx on api_keys (label);
```

`members` has a two-column constraint that allows one membership per email per workspace. `api_keys` has two unique indexes and no constraint: one on `lower(label)`, one on `label` itself. `workspaces.id` and the other primary keys are not `UNIQUE` constraints of `contype = 'u'`.

## What the dry run reports

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   api_keys -> workspaces -> members

  api_keys                         25 rows  ~$0.0018
  workspaces                       25 rows  ~$0.0018
  members                          25 rows  ~$0.0036

  estimated cost: $0.0072

  simulating + validating...
  api_keys . (dry-run)
  workspaces . (dry-run)
  members . (dry-run)

  ✓ no validation findings across 3 tables
```

It reports no uniqueness finding for those constraints and indexes. Other validation rules still apply to the simulated rows. This run had no null, type, or foreign-key finding either. The plan still orders `workspaces` before `members`, which is the primary-key edge, not the skipped unique constraint.

The validator's coverage list in [`validate.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/validate.ts) names "Single-column UNIQUE duplicates within the batch" as checked and "Multi-column UNIQUE constraints" as out of scope for v0.3.x. It can only check uniqueness the introspection step found.

## What introspection reads

This is the uniques query from [`introspect.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/introspect.ts), with the schema parameter filled in as `'public'`:

```sql
select
  cls.relname as table_name,
  att.attname as column_name
from pg_constraint con
join pg_class cls     on cls.oid = con.conrelid
join pg_namespace ns  on ns.oid = cls.relnamespace
join pg_attribute att on att.attrelid = cls.oid and att.attnum = con.conkey[1]
where con.contype = 'u'
  and cardinality(con.conkey) = 1
  and ns.nspname = 'public'
  and not cls.relispartition;
```

```
 table_name | column_name 
------------+-------------
(0 rows)
```

Two filters exclude them. `contype = 'u'` restricts the query to unique constraints in `pg_constraint`, and a bare `create unique index` creates no row there. `cardinality(con.conkey) = 1` drops every constraint over more than one column. The comment above the query says: "Multi-col uniques require coordinated generation across columns; we skip them in v0.x to keep the failure surface small."

Every unique index Postgres will enforce on these tables is in `pg_index`:

```sql
select c.relname as table_name,
       i.relname as index_name,
       x.indnkeyatts as key_columns,
       x.indexprs is not null as has_expression,
       con.conname is not null as is_constraint
from pg_index x
join pg_class i on i.oid = x.indexrelid
join pg_class c on c.oid = x.indrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_constraint con on con.conindid = x.indexrelid and con.contype = 'u'
where n.nspname = 'public' and x.indisunique and not x.indisprimary
order by 1, 2;
```

```
 table_name |         index_name          | key_columns | has_expression | is_constraint 
------------+-----------------------------+-------------+----------------+---------------
 api_keys   | api_keys_label_idx          |           1 | f              | f
 api_keys   | api_keys_label_lower_idx    |           1 | t              | f
 members    | members_workspace_email_key |           2 | f              | t
(3 rows)
```

Postgres enforces all three, and the uniques query reads none of them. `api_keys_label_idx` covers one plain column, and it is skipped only because it was declared as an index. The same rule as a constraint is read:

```sql
alter table workspaces add constraint workspaces_name_key unique (name);
```

```
 table_name | column_name 
------------+-------------
 workspaces | name
(1 row)
```

A single-column unique index on a plain column can be turned into a constraint in place with `unique using index`. An expression index cannot:

```sql
alter table api_keys add constraint api_keys_label_key unique using index api_keys_label_idx;
alter table api_keys add constraint api_keys_label_lower_key unique using index api_keys_label_lower_idx;
```

```
NOTICE:  ALTER TABLE / ADD CONSTRAINT USING INDEX will rename index "api_keys_label_idx" to "api_keys_label_key"
ALTER TABLE
ERROR:  index "api_keys_label_lower_idx" contains expressions
LINE 1: alter table api_keys add constraint api_keys_label_lower_key...
                                 ^
DETAIL:  Cannot create a primary key or unique constraint using such an index.
```

After that, the uniques query returns both single-column constraints:

```
 table_name | column_name 
------------+-------------
 api_keys   | label
 workspaces | name
(2 rows)
```

The index is renamed to match the constraint, which matters if a migration elsewhere refers to it by its old name. Case-insensitive uniqueness through `lower(label)` stays an index, and the uniques query does not read it.

## What a collision does to a run

Postgres enforces every one of those indexes on insert, whoever wrote the row. satus writes a run in a single transaction, so a collision with a rule satus did not read fails the run and rolls back the table changes. Identity sequences can remain advanced. The same sequence in plain SQL:

```sql
begin;
insert into workspaces (name) values ('acme'), ('globex');
insert into members (workspace_id, email, role)
select id, 'ana@example.com', 'member' from workspaces;
insert into members (workspace_id, email, role)
select id, 'ana@example.com', 'owner' from workspaces where name = 'acme';
rollback;
select count(*) from workspaces;
select last_value, is_called from workspaces_id_seq;
```

```
BEGIN
INSERT 0 2
INSERT 0 2
ERROR:  duplicate key value violates unique constraint "members_workspace_email_key"
DETAIL:  Key (workspace_id, email)=(1, ana@example.com) already exists.
ROLLBACK
 count 
-------
     0
(1 row)

 last_value | is_called 
------------+-----------
          2 | t
(1 row)
```

The same email in two workspaces is allowed. The second membership in `acme` is not. After the rollback the table is empty and the identity sequence is still at 2. This environment had no provider key, so there is no output from a real `satus generate` run.

## NULL is distinct by default

A composite unique constraint allows repeated keys when any key column is NULL, under the default `NULLS DISTINCT` behavior. These three rows use the same workspace and the same NULL email:

```sql
create table invites (
  workspace_id integer not null references workspaces(id),
  email        text,
  constraint invites_workspace_email_key unique (workspace_id, email)
);
insert into workspaces (name) values ('initech');
insert into invites (workspace_id, email)
select id, null from workspaces, generate_series(1, 3);
select workspace_id, email, count(*) from invites group by 1, 2;
alter table invites drop constraint invites_workspace_email_key;
alter table invites add constraint invites_workspace_email_key
  unique nulls not distinct (workspace_id, email);
```

```
INSERT 0 1
INSERT 0 3
 workspace_id | email | count 
--------------+-------+-------
            3 |       |     3
(1 row)

ALTER TABLE
ERROR:  could not create unique index "invites_workspace_email_key"
DETAIL:  Key (workspace_id, email)=(3, null) is duplicated.
```

`last_value` on `workspaces_id_seq` is 3. The new workspace got id 3 because the rolled-back transaction above had already drawn 1 and 2, and sequence values are not returned on rollback. `NULLS NOT DISTINCT`, available since PostgreSQL 15, makes Postgres treat NULLs as equal for this constraint, and Postgres refuses to add it while the duplicates exist.

## What would change in satus

Multi-column unique constraints are item 2 of Phase 2 in the [roadmap at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/docs/ROADMAP.md). They are not in 0.3.11. The 0.3.12 dry run above also reported no uniqueness finding for the composite constraint or the expression index. Until a release reads them, run the `pg_index` query above against your schema: every row it returns with `is_constraint` false or `key_columns` above 1 is a rule Postgres enforces and the unique-column check does not plan for.

Run the dry run against your own schema first. It needs no key and writes nothing, and the [quickstart](/quickstart) has the install line.

## Sources

- Every transcript above: PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2), `psql` 17.11, `@passkeybridge/satus@0.3.12` on Node v24.21.0, run 2026-11-06 with no provider key set. No rows were written by a real `satus generate` run.
- The uniques query and the reason for skipping multi-column uniques: the `v_uniques` CTE in [`packages/cli/src/generate/introspect.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/introspect.ts).
- Validator coverage: the header comment of [`packages/cli/src/generate/validate.ts` at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/src/generate/validate.ts).
- `NULLS NOT DISTINCT`: the PostgreSQL 17 docs on [unique constraints](https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS) and the [PostgreSQL 15 release notes](https://www.postgresql.org/docs/release/15.0/). Sequence gaps after an abort: [sequence functions](https://www.postgresql.org/docs/17/functions-sequence.html).
- The v0.x limits: the [README at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/packages/cli/README.md). Phase 2 scope: the [roadmap at v0.3.11](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.11/docs/ROADMAP.md).

Source-visible and commercially licensed. Not open source. See `LICENSE`.
