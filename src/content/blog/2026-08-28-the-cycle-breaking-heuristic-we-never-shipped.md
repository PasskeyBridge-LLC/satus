---
slug: the-cycle-breaking-heuristic-we-never-shipped
title: The cycle-breaking heuristic we documented and never shipped
description: In May we published a four-rule heuristic for choosing which foreign key to defer. Running it against the shipped binary this week, three of the four rules do not exist.
date: 2026-08-28
publishAt: 2026-08-28T09:00:00-04:00
author: satus.sh
tags: [postgres, foreign-keys, audit, cli]
draft: false
---

In May we published [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), which explains how satus seeds a schema whose foreign-key graph has a cycle. The mechanism in that post is still accurate: split the cycle, insert the back-edge column as `NULL`, back-patch it in a second pass, never disable a constraint. That part holds up.

One block in it does not. The post specifies a four-rule heuristic for deciding *which* edge to defer. This week we sat down to write a follow-up, ran the heuristic against the shipped binary to get a transcript, and found that three of the four rules are not in the code and never have been.

Everything below was measured on PostgreSQL 16.13 against `@passkeybridge/satus` as shipped.

## What we published

Verbatim from the May post:

```text
prefer to defer the column that:
  1. is nullable,                              else
  2. has a DEFAULT,                            else
  3. participates in fewer downstream FKs,     else
  4. is alphabetically later (deterministic tiebreaker).
```

## What the code does

`packages/cli/src/generate/dag.ts`, the whole of the selection logic:

```ts
const candidates = workingEdges
  .filter((e) => unresolved.has(e.from) && unresolved.has(e.to) && e.nullable)
  .sort((a, b) => (a.to + '.' + a.column).localeCompare(b.to + '.' + b.column))
if (candidates.length === 0) {
  return { order, cycle: Array.from(unresolved).sort(), brokenEdges }
}
const pick = candidates[0]!
```

One filter, on `nullable`. One sort, ascending. Take the first. There is no rule 2, no rule 3, and rule 4 runs in the opposite direction to the one we described.

The `nullable` flag itself is built from a single field:

```ts
nullable: col?.isNullable === true,
```

Three experiments, one per missing rule.

## Rule 2: a DEFAULT does not make a column deferrable

A cycle in which neither back-edge is nullable, but one has a `DEFAULT`:

```sql
create table a (id integer generated always as identity primary key, name text not null);
create table b (id integer generated always as identity primary key, name text not null,
                a_id integer not null);
alter table a add column b_id integer not null default 1;
alter table a add constraint a_b_fk foreign key (b_id) references b(id);
alter table b add constraint b_a_fk foreign key (a_id) references a(id);
```

By the published rules, `a.b_id` has a `DEFAULT`, so rule 2 should select it and the seed should proceed. What actually happens:

```text
FK cycle detected with no nullable back-edge: a, b
  satus v0.2 breaks cycles by NULLing a nullable back-edge column and populating
  it after every table is seeded. None of the cycle FKs are nullable, so the
  cycle cannot be broken without violating NOT NULL.
  Fix: make one of the FK columns nullable, or `exclude` one of the tables in
  satus.config.json and re-run.
EXIT=10
```

Exit `10` is `E_FK_CYCLE`, the [documented](/docs/troubleshooting) "satus declined to act" code. The `DEFAULT` is not consulted.

## Rule 4: the tiebreaker runs backwards

Two nullable back-edges, so only the tiebreaker can decide. The sort key is `<child_table>.<column>`, which makes the two candidates `alpha.zulu_id` and `zulu.alpha_id`:

```sql
create table alpha (id integer generated always as identity primary key, name text not null);
create table zulu  (id integer generated always as identity primary key, name text not null,
                    alpha_id integer references alpha(id));
alter table alpha add column zulu_id integer references zulu(id);
```

"Alphabetically later" selects `zulu.alpha_id`. The run:

```text
  tables:   alpha -> zulu
  cycles:   alpha.zulu_id -> zulu (deferred)
```

`alpha.zulu_id` is the alphabetically *earlier* key. The behaviour is deterministic, which was the actual point of having a tiebreaker, but the direction we published is inverted.

## Rule 3: downstream FK count changes nothing

Same cycle, with two more tables referencing `zulu` so the two sides are lopsided:

```sql
create table ref_one (id integer generated always as identity primary key,
                      zulu_id integer not null references zulu(id));
create table ref_two (id integer generated always as identity primary key,
                      zulu_id integer not null references zulu(id));
```

```text
FKs referencing zulu: 3
FKs referencing alpha: 1

  tables:   alpha -> zulu -> ref_one -> ref_two
  cycles:   alpha.zulu_id -> zulu (deferred)
```

Identical pick. Three-to-one weighting has no effect, because nothing counts downstream foreign keys anywhere in the codebase.

## The code is right and the documentation was wrong

The tempting fix is to implement what we published. We are not going to, and the `DEFAULT` schema above is the reason.

`a.b_id integer not null default 1` reads like a safe deferral target. It is a promise that `b` contains a row with `id = 1`. Nothing enforces that promise. In a database satus is about to seed, `b` is usually empty:

```text
--- a.b_id is NOT NULL DEFAULT 1, referencing b(id). Is b(id)=1 guaranteed? ---
 rows_in_b
-----------
         0

--- what a DEFAULT-based deferral would actually do ---
ERROR:  insert or update on table "a" violates foreign key constraint "a_b_fk"
DETAIL:  Key (b_id)=(1) is not present in table "b".
```

Deferring onto a `DEFAULT` does not avoid the violation. It relocates it from a comprehensible planning-time refusal into a failed insert partway through a run. `NULL` is different in kind: it is the schema's own statement that absence is legal for that column, which is exactly the license a two-pass insert needs.

Rule 3 is a smaller story. Preferring the lightly-referenced side would be a reasonable optimisation, but it optimises the wrong thing. The back-patch pass is one bulk `UPDATE` per broken edge, linear in the deferring table, and both candidates in a two-table cycle are already cheap. We would be adding a graph computation to pick between two options that cost about the same.

So the honest position is that rule 1 plus a deterministic tiebreaker is the whole design, and the other two rules were prose that got ahead of the code.

## While we were in there: a statement that does nothing

`generate.ts` opens the seeding transaction like this:

```ts
await client.query('begin')
if (brokenEdges.length > 0) {
  await client.query('set constraints all deferred')
}
```

[`SET CONSTRAINTS`](https://www.postgresql.org/docs/current/sql-set-constraints.html) only affects constraints declared `DEFERRABLE`, and Postgres defaults to `NOT DEFERRABLE`. The `ALL` form is accepted regardless, so this never errors. It also, in the ordinary case, does nothing:

```text
      conname       | condeferrable | condeferred
--------------------+---------------+-------------
 zulu_alpha_id_fkey | f             | f
 alpha_zulu_id_fkey | f             | f

BEGIN
SET CONSTRAINTS
  (statement accepted)
ERROR:  insert or update on table "alpha" violates foreign key constraint "alpha_zulu_id_fkey"
DETAIL:  Key (zulu_id)=(999999) is not present in table "zulu".
ROLLBACK
```

Accepted, and then the foreign key fires immediately anyway. All of the cycle-breaking is done by the `NULL` and the back-patch; the `SET CONSTRAINTS` line only earns its place on schemas where someone declared their foreign keys [`DEFERRABLE`](https://www.postgresql.org/docs/current/sql-createtable.html), which is rare.

Relatedly, introspection reads `condeferrable` and `condeferred` into `deferrable` and `initiallyDeferred` on every foreign key, and a comment above the query says the runner uses them to decide whether a cycle is breakable by deferral. Nothing reads either field. They are introspected, typed, threaded through, and dead.

## What we changed

The May post now carries a dated correction pointing here. We did not rewrite its algorithm section, because the algorithm section was right; the heuristic block was the part that described work we had not done.

We did not change `dag.ts`. Reversing the tiebreaker to match the old prose would break determinism for anyone whose fixtures depend on the current pick, to satisfy a sentence rather than a user. The two dead fields and the inert `SET CONSTRAINTS` call are on the list, and neither is urgent: one is unread data, the other is a no-op.

This is the second time in a month that writing a post has been the thing that caught a false claim, after [information_schema is privilege-filtered](/blog/information-schema-is-privilege-filtered) turned up a real bug in our own introspection query. We are starting to think of the accuracy gate less as a publishing chore and more as the cheapest audit we run.

## Sources

- [PostgreSQL: `SET CONSTRAINTS`](https://www.postgresql.org/docs/current/sql-set-constraints.html)
- [PostgreSQL: `CREATE TABLE`](https://www.postgresql.org/docs/current/sql-createtable.html) (constraint deferrability)
- [PostgreSQL: `pg_constraint`](https://www.postgresql.org/docs/current/catalog-pg-constraint.html)
- Our own earlier post, and the block this one corrects: [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild)
