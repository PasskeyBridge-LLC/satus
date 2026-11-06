---
slug: how-satus-decides-a-database-is-too-full-to-seed
title: How satus 0.3.12 decides a database is too full to seed
description: How satus 0.3.12 counts rows the connected role can read in ordinary tables, when that count exits 11, and how privileges, RLS, and --force change it.
date: 2026-11-06
publishAt: 2026-11-06T09:00:00-05:00
author: satus.sh
tags: [seeding, postgres, safety, ci]
draft: false
---

`satus generate` writes rows into the configured database. `--dsn` overrides `SATUS_DATABASE_URL`, which overrides `DATABASE_URL`, which overrides `databaseUrl` in `satus.config.json`. Before it introspects the schema or calls a model, `@passkeybridge/satus@0.3.12` counts rows visible to the connected role in eligible ordinary tables and, on a real run, refuses when that count is greater than 10,000. The guard exists to catch a connection string pointed at a database you did not mean to seed.

The count is not a census of every user table. It skips relation kinds other than ordinary tables (`relkind = 'r'`), system schemas, and tables the role cannot read. Row-level security can hide rows the role is allowed to `SELECT`. A count under 10,001 is not proof that the database has no production data.

Every transcript below ran on 2026-11-06 against PostgreSQL 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit`), `psql` 17.11 (Debian 17.11-1.pgdg13+2), Node v24.21.0, and `@passkeybridge/satus@0.3.12`. No provider key was set unless a command shows `OPENAI_API_KEY=placeholder`. That placeholder is checked for presence and is not sent: the refusals below still exited 11 with `fetch` disabled in the process.

## The rule

The code is [`guard.ts` at tag v0.3.12](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.12/packages/cli/src/generate/guard.ts). It lists `relkind = 'r'` outside `pg_catalog`, `information_schema`, and the `pg_toast` and `pg_temp` schemas. A table stays in the count only when `has_schema_privilege(n.oid, 'USAGE')` and `has_table_privilege(c.oid, 'SELECT')` are both true. Readable tables are summed in statements of up to 100. Each table is a subquery `select count(*) from (select 1 from ... limit 10001) s`. After that statement returns, the loop stops if the accumulated total is greater than 10,000. The limit caps rows returned to the aggregate. It does not cap physical I/O, dead-tuple work, or policy evaluation. The loop does not stop in the middle of a 100-table statement.

It counts real rows. `pg_class.reltuples` is stale between `ANALYZE` runs and is `-1` for a table that has never been analyzed. A newly restored table can be in that state. It is not guaranteed: an autovacuum pass or a restore workflow can already have analyzed it.

Direct foreign-table candidates are excluded. A count of an ordinary inheritance parent includes descendants, because the query does not use `ONLY`. An inherited row can therefore be counted on both the parent and the child, and a foreign child can still be read through its parent.

In 0.3.11 the same check resolved a schema-qualified name before the privilege test, and a role without `USAGE` on `audit` exited 1. [Pull request 60](https://github.com/PasskeyBridge-LLC/satus/pull/60) (`56cc461`) switched the check to the OID form above. That commit is in the v0.3.12 tag.

## 10,000 rows passes

`DATABASE_URL` for this section is `postgresql://postgres:postgres@127.0.0.1:5433/guard_dev`, with no `satus.config.json` in the working directory.

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

create schema audit;

create table audit.events (
  id      bigint generated always as identity primary key,
  payload text not null
);

insert into audit.events (payload)
select 'event ' || g from generate_series(1, 10000) g;

select
  (select count(*) from audit.events) as audit_events,
  (select count(*) from customers) as customers,
  (select count(*) from orders) as orders;
```

```
 audit_events | customers | orders 
--------------+-----------+--------
        10000 |         0 |      0
(1 row)
```

```
$ satus generate --dry-run --rows 25

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

The exit code is 0. The threshold is "more than 10,000".

## 10,001 rows

```sql
insert into audit.events (payload) values ('event 10001');

select
  (select count(*) from audit.events) as audit_events,
  (select count(*) from customers) as customers,
  (select count(*) from orders) as orders;
```

```
 audit_events | customers | orders 
--------------+-----------+--------
        10001 |         0 |      0
(1 row)
```

The dry run prints a warning and continues. This dry run still exits 0 because its simulated rows have no validation errors. Exceeding the row guard only produces a warning in dry-run mode. A later validation error still exits 2. On `guard_exit2`, `pile` has 10,001 rows and `codes.code` is `char(3)` and `UNIQUE`. The dry run warns and then exits 2:

```
$ satus generate --dry-run --rows 25
  ! this database holds more than 10,000 rows; a real run would be refused (exit 11). Use --force to override.

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   codes -> pile

  codes                            25 rows  ~$0.0018
  pile                             25 rows  ~$0.0009

  estimated cost: $0.0027

  simulating + validating...
  codes . (dry-run)
  pile . (dry-run)

  findings: 24 error / 0 warn
  error codes.code                           unique_duplicate   x24  rows[1,2,3+]
         Duplicate value in UNIQUE column "code" within the same batch
```

```
$ satus generate --dry-run --rows 25
  ! this database holds more than 10,000 rows; a real run would be refused (exit 11). Use --force to override.

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

A real run needs a provider key to reach the guard. A missing key exits 1 first.

```
$ OPENAI_API_KEY=placeholder satus generate --rows 25
Refusing to run: this database already holds more than 10,000 rows across 3 user table(s).
  satus generate writes rows, and a database this full is usually not the one you meant
  to seed. Check DATABASE_URL.
  If it is the right database — a staging environment with real fixtures, say — re-run
  with --force.
```

The exit code is 11. The same counts after the refusal:

```
 audit_events | customers | orders 
--------------+-----------+--------
        10001 |         0 |      0
(1 row)
```

The message counts three user tables, including `audit.events`. The run was asked to seed `public`. The rows that tripped the guard are in another schema.

## `--schema` does not narrow the count

```
$ satus generate --dry-run --rows 25 --schema audit
  ! this database holds more than 10,000 rows; a real run would be refused (exit 11). Use --force to override.

satus generate
  schema:   audit
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   events

  events                           25 rows  ~$0.0018

  estimated cost: $0.0018

  simulating + validating...
  events . (dry-run)

  ✓ no validation findings across 1 tables
```

`--schema` chooses the tables to introspect. The guard still counts readable ordinary tables in non-system schemas.

## Relation kinds

On a fresh database `guard_mat`, `audit.events` has 10,000 rows, `public.customers` is empty, and a materialized view holds 20,000 rows:

```sql
create materialized view events_copy as
select g as id, 'c' || g as payload
from generate_series(1, 20000) g;

select count(*) as events from audit.events;
select count(*) as matview from events_copy;

select n.nspname, c.relname, c.relkind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg\_toast%'
order by 1, 2;
```

```
 events 
--------
  10000
(1 row)

 matview 
---------
   20000
(1 row)

 nspname |  relname  | relkind 
---------+-----------+---------
 audit   | events    | r
 public  | customers | r
(2 rows)
```

`events_copy` is `relkind = 'm'` and is absent from that list. The dry run does not warn:

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers

  customers                        25 rows  ~$0.0018

  estimated cost: $0.0018

  simulating + validating...
  customers . (dry-run)

  ✓ no validation findings across 1 tables
```

Views (`'v'`) hold no rows of their own. On `guard_views`, a partitioned parent and one leaf look like this after `audit.events` is back at 10,000 and the leaf has one row:

```
 nspname |    relname    | relkind 
---------+---------------+---------
 audit   | events        | r
 public  | events_p1     | r
 public  | events_parent | p
(3 rows)
```

The leaf is an ordinary table, so it is counted. The parent is `'p'` and is not. 10,000 plus that one leaf row is over the threshold, and the plan still names the parent, which is what a run seeds:

```
$ satus generate --dry-run --rows 25
  ! this database holds more than 10,000 rows; a real run would be refused (exit 11). Use --force to override.

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   events_parent

  events_parent                    25 rows  ~$0.0018

  estimated cost: $0.0018

  simulating + validating...
  events_parent . (dry-run)

  ✓ no validation findings across 1 tables
```

A foreign table created with `postgres_fdw` came back as `relkind = 'f'` and did not appear in the guard's candidate list.

Inheritance is a separate case. On `guard_inherit`, `parent_rows` has one row of its own, `child_rows` inherits it and has one row, and `remote_child` is a foreign table that also inherits `parent_rows` and has one row. `select count(*) from parent_rows` returns 3. `select count(*) from only parent_rows` returns 1. The guard's shape of query, without `ONLY`, sums to 4: the parent read sees the local child and the foreign child, and the local child is counted again as its own table. The same sum with `ONLY` on the parent is 2.

```
 guard_style_total | with_only 
-------------------+-----------
                 4 |         2
(1 row)

   relname    | relkind 
--------------+---------
 child_rows   | r
 parent_rows  | r
 remote_child | f
(3 rows)
```

## A role that cannot read `audit`

In this example the seeding role can read `public` and cannot use `audit`. `DATABASE_URL` for the superuser side is `guard_roles`, where `audit.events` has 10,001 rows and `public` is empty.

```sql
create role seeder login password 'seeder';
grant usage on schema public to seeder;
grant select, insert, update, delete on all tables in schema public to seeder;
```

As `seeder`, with no `USAGE` on `audit`, 0.3.12 skips `audit.events` and the dry run does not warn:

```
$ satus generate --dry-run --rows 25 --dsn postgresql://seeder:seeder@127.0.0.1:5433/guard_roles

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

`grant usage on schema audit to seeder` without `SELECT` on `audit.events` prints the same plan and the same absence of a warning. After `grant select on audit.events to seeder`, the dry run warns, because this role can now see the 10,001 rows. In this example the role that can read `audit` trips the guard, and the role that cannot read it does not. Either role trips the guard when the tables it can see exceed 10,000. The implementation comment says a role that cannot read a table is not seeding it. `SELECT` and `INSERT` are separate privileges; that sentence is the reason the guard skips, not a rule Postgres enforces.

When a refusal does skip tables, the message says how many. On `guard_dev`, a role that could read the four ordinary tables that held the rows, and could not read one extra table, produced:

```
Refusing to run: this database already holds more than 10,000 rows across 4 user table(s) (1 table(s) skipped — no SELECT privilege).
  satus generate writes rows, and a database this full is usually not the one you meant
  to seed. Check DATABASE_URL.
  If it is the right database — a staging environment with real fixtures, say — re-run
  with --force.
```

## Row-level security

On `guard_rls`, `visible_rows` has 10,001 rows, RLS is enabled, and the only policy is `using (false)`. The table owner bypasses RLS unless `FORCE ROW LEVEL SECURITY` is set, so the owner's dry run warns. `reader` has `USAGE` on `public` and `SELECT` on the table. Under the policy it sees 0 rows, and its dry run does not warn.

```
 owner_count 
-------------
       10001
(1 row)

 reader_count 
--------------
            0
(1 row)
```

## A table with no `ANALYZE` statistics

On a new table of 500 rows, before `ANALYZE`:

```
 relname  | reltuples | relpages 
----------+-----------+----------
 restored |        -1 |        0
(1 row)
```

After `ANALYZE`, `reltuples` is 500. The guard does not read `reltuples` either way.

## Which connection string is counted

`guard_dsn_full` has 10,001 rows. `guard_dsn_empty` has the same empty table and no rows. With `DATABASE_URL` pointed at the full database, `--dsn` pointed at the empty one, the dry run does not warn. With no environment variable and a `satus.config.json` whose `databaseUrl` is the full database, the dry run warns. `--dsn` pointed at the empty database overrides that file, and the dry run does not warn. `SATUS_DATABASE_URL` pointed at the empty database overrides `DATABASE_URL` pointed at the full one, and that dry run does not warn either.

## One hundred tables, then a stop

`guard_chunk` has 101 ordinary tables: `a_big` with 10,001 rows, `b01` through `b99` empty, and `c_extra` empty. The refusal names 100 tables, the size of one counting statement, and does not include `c_extra`:

```
$ OPENAI_API_KEY=placeholder satus generate --rows 25
Refusing to run: this database already holds more than 10,000 rows across 100 user table(s).
  satus generate writes rows, and a database this full is usually not the one you meant
  to seed. Check DATABASE_URL.
  If it is the right database — a staging environment with real fixtures, say — re-run
  with --force.
```

The exit code is 11. `a_big` is the first table in name order and already holds 10,001 rows, and the scanned count is still 100, so the statement finished the chunk before the loop stopped.

## `--force`

`--force` does not call the count. On `guard_roles`, still at 10,001 rows, the dry run prints no warning:

```
$ satus generate --dry-run --rows 25 --force

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

## Guard and transaction boundaries

The guard is not a permission system, and it does not roll anything back. It runs before the write transaction begins. Real-run inserts and updates share one transaction and roll back on failure. Sequence values allocated by ordinary inserts can remain consumed after rollback. On `guard_dev`:

```sql
create table seqdemo (id integer generated always as identity primary key);
begin;
insert into seqdemo default values;
insert into seqdemo default values;
rollback;
select count(*) as rows_after_rollback from seqdemo;
select last_value, is_called from seqdemo_id_seq;
```

```
 rows_after_rollback 
---------------------
                   0
(1 row)

 last_value | is_called 
------------+-----------
          2 | t
(1 row)
```

`TRUNCATE ... RESTART IDENTITY` inside a transaction is a different case: rolling that statement back restores the identity restart. Ordinary `nextval` allocations are not restored.

The other published v0.x limits still apply to any run that passes the guard: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
