---
slug: triggers-i-have-loved-and-hated
title: Triggers I have loved and hated
description: Audit, denormalization, and validation triggers each break a Postgres seed run differently. What actually happens, measured on PostgreSQL 17.9.
date: 2026-08-05
author: satus.sh
tags: [postgres, triggers]
draft: false
---

Every other constraint in Postgres is declarative. A `NOT NULL` tells you what it will reject. A `CHECK` tells you the predicate. A foreign key tells you the parent. A trigger tells you nothing: it is arbitrary code attached to a write, and the only way to know what it does is to read the function body.

That is a problem for a seeding tool. satus introspects `pg_catalog` for tables, columns, keys, and constraints, then asks a model for rows that fit. It does **not** introspect `pg_trigger`, and it does not attempt to predict what a trigger function will do. So the honest question is not "how does satus handle triggers" but "what happens to a seed run when triggers are present, and what can you do about it".

Everything below was measured on PostgreSQL 17.9 with a three-table schema, not reasoned about from the docs.

## The four categories

### 1. BEFORE row triggers that rewrite the row

The one I have loved. A `BEFORE INSERT ... FOR EACH ROW` trigger that returns a modified `NEW` changes the row before it lands.

```sql
create function f_slug() returns trigger language plpgsql as $$
begin
  NEW.slug := lower(replace(NEW.name, ' ', '-'));
  return NEW;
end $$;
create trigger tg_slug before insert on projects
  for each row execute function f_slug();
```

satus's writer uses parameterized multi-row `INSERT ... RETURNING` and chains the returned primary keys into the next table's foreign keys. The question that matters is whether `RETURNING` reflects the trigger's edit or the value satus sent. It reflects the trigger:

```text
insert into projects(org_id, name) values (1,'Apollo Two'),(2,'Zeus One')
  returning id, slug;

 id |    slug
----+------------
  1 | apollo-two
  2 | zeus-one
```

This is the good case, and it holds for surrogate keys too. If a `BEFORE INSERT` trigger overwrites the primary key, satus's downstream foreign keys still point at real parents, because they are built from `RETURNING` output rather than from what the model produced.

### 2. Audit triggers

The category that is harmless per run and annoying across runs. An `AFTER INSERT OR UPDATE` trigger writing to a log table produces one audit row per seeded row:

```text
2 projects inserted        -> audit_rows = 2
1 broken-edge UPDATE       -> audit_rows = 3
truncate projects cascade  -> audit_rows = 3
```

Two things to notice.

The `UPDATE` is satus's own. When a foreign-key cycle is broken, the child row lands with `NULL` in the back-edge column and is patched afterward with one `UPDATE` per row, which is exactly why the third audit row exists. If your audit trigger fires on `UPDATE`, a cyclic schema produces more audit rows than seeded rows. The cycle mechanics are in [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild).

The `TRUNCATE` fired nothing. Row-level triggers do not fire on `TRUNCATE`; only `FOR EACH STATEMENT ... ON TRUNCATE` triggers do. satus truncates the tables in the run set with `TRUNCATE ... RESTART IDENTITY`, so an audit table outside the run set is untouched. Re-run the seed ten times and you have ten generations of audit rows describing tables whose rows no longer exist.

The fix is boring and it works: put the audit table in `exclude` in `satus.config.json` so satus never seeds it directly, and truncate it yourself in the same script that calls satus if you want a clean slate.

> **Update, 2026-08-10.** As published, this section said satus truncates with `TRUNCATE ... RESTART IDENTITY CASCADE` and explained that an audit table with no foreign key back to the audited table falls outside the cascade graph and therefore survives. That was accurate for v0.3.6 and earlier, and the advice above was correct — but it only held because the audit table in this example has no FK. Give it one (`audit_rows.project_id references projects(id)`, a perfectly ordinary design) and `CASCADE` would have emptied it, with nothing louder than a `NOTICE`. [v0.3.7](/blog/v0-3-7-release-notes) drops `CASCADE`: satus now refuses to truncate rather than reach outside the run set. The paragraph has been corrected to describe current behaviour.

### 3. Denormalization triggers

The category I have hated, because it fails silently and it fails on a column that looks fine.

```sql
create function f() returns trigger language plpgsql as $$
begin
  update orgs set project_count = project_count + 1 where id = NEW.org_id;
  return null;
end $$;
```

Whether this hurts depends entirely on whether the counter column has a default.

If `project_count` is declared `int not null default 0`, satus never generates a value for it. The schema builder skips every column with a default, on the grounds that the database will fill it. The trigger then owns the column outright and the count is correct.

If it is declared `int not null` with no default, satus must supply a value, the model supplies a plausible one, and the trigger adds to it:

```text
orgs seeded with project_count = 7
2 projects inserted, trigger increments twice

 id | stored | actual
----+--------+--------
  1 |      9 |      2
```

Nine stored, two actual. Nothing errored. No constraint was violated. Every dashboard reading that counter is now wrong, and the only signal is that the number looks slightly off. Add the counter column to a `CHECK` if you can, or accept that denormalized counters need a reconciliation pass after seeding: `update orgs set project_count = (select count(*) from projects p where p.org_id = orgs.id)`.

This is the same failure shape as the one in [CHECK constraints that lie](/blog/check-constraints-that-lie): the database accepted the row, so the tool believes it succeeded.

### 4. Validation triggers

The category that is loud, and therefore fine. A `BEFORE INSERT` trigger that raises aborts the statement, and because satus wraps the entire run in one `BEGIN`/`COMMIT`, it aborts everything:

```text
BEGIN
ERROR:  name must be capitalized: bad one
CONTEXT:  PL/pgSQL function f_validate() line 2 at RAISE
ROLLBACK

 projects_after_failed_batch
-----------------------------
                           0
```

Zero rows. Not a partial seed, not a half-populated parent table with orphaned children waiting on it. The transactional writer means a trigger rejection costs you the run and nothing else, which is the correct trade for a tool that people point at development databases.

The practical consequence is that a validation trigger encoding a business rule the model cannot infer (a naming convention, a tenant-prefix format, a checksum) will fail the run every time. satus builds its prompt from column names, types, and declared constraints; a rule that exists only inside a PL/pgSQL body is invisible to it. Move the rule into a `CHECK` constraint where you can, or `exclude` the table and seed it yourself.

### The fifth category: triggers that leave the database

Extensions such as [pg_net](https://github.com/supabase/pg_net) make it possible for a trigger to issue an HTTP request on write. Nothing in Postgres stops you from attaching that to a table a seeding tool is about to write two hundred rows into.

satus has no way to detect this. It sees a table and a set of columns. If a webhook fires two hundred times against a staging endpoint, that is a property of your schema, not of the seed. Before pointing any seeding tool at an unfamiliar database, this query is worth thirty seconds:

```sql
select tgrelid::regclass as table, tgname, pg_get_triggerdef(oid)
from pg_trigger
where not tgisinternal
order by 1;
```

`tgisinternal` filters out the system triggers Postgres creates to enforce foreign keys, which would otherwise dominate the output.

## What the dry run does and does not tell you

`satus generate --dry-run` validates generated rows against live catalog metadata without inserting anything: null checks, type and range checks, `varchar(n)` overflow, foreign-key targets, and single-column uniqueness within a batch. It cannot evaluate a trigger, because evaluating a trigger means executing it, and executing it means writing. That limit was stated when the dry run shipped in [A $0 dry-run that catches FK and constraint bugs before the LLM call](/blog/dry-run-validation) and it has not moved.

So the split is clean. Everything declarative is checkable offline. Everything procedural is only knowable at insert time, and the transaction is what protects you.

## The short version

| Trigger kind | Effect on a satus run | What to do |
| --- | --- | --- |
| `BEFORE` row, rewrites `NEW` | Safe. `RETURNING` reflects the edit, so FK chaining stays correct | Nothing |
| Audit / history | Extra rows per insert, plus one per cycle back-patch `UPDATE`; survives `--truncate` | `exclude` the log table, truncate it yourself |
| Denormalization counter | Silent drift when the counter column has no default | Give the column a default, or reconcile after seeding |
| Validation, raises | Whole run rolls back, zero rows written | Encode the rule in a `CHECK`, or `exclude` the table |
| HTTP / side-effecting | Fires per row, invisible to satus | Audit `pg_trigger` before seeding an unfamiliar database |

Triggers are the part of a schema that a catalog read cannot summarize. satus will not pretend otherwise, and the two defenses it does offer, one transaction and an `exclude` list, are the ones that hold.

## References

- Measured on PostgreSQL 17.9, three-table schema, `pg_ctl`-managed local cluster. All output in this post is verbatim `psql` output.
- PostgreSQL documentation: [Trigger behavior overview](https://www.postgresql.org/docs/current/trigger-definition.html), [`CREATE TRIGGER`](https://www.postgresql.org/docs/current/sql-createtrigger.html), [`pg_trigger`](https://www.postgresql.org/docs/current/catalog-pg-trigger.html), [`TRUNCATE`](https://www.postgresql.org/docs/current/sql-truncate.html).
- Source: [`writer.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/writer.ts) for the transactional insert path, [`schema.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/schema.ts) for the defaulted-column skip rule.
- Related: [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), [CHECK constraints that lie](/blog/check-constraints-that-lie), [Generated columns are load-bearing now](/blog/generated-columns-are-load-bearing-now), [What pg_dump doesn't tell you about your own schema](/blog/what-pg-dump-doesnt-tell-you).

—the satus.sh team
