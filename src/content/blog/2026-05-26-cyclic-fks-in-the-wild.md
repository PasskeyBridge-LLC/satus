---
slug: cyclic-fks-in-the-wild
title: Cyclic foreign keys in the wild
description: Most seed-data tools pretend cycles don't exist. They do. Here is how satus splits the graph, inserts with NULLs, and back-patches in a second pass.
date: 2026-05-26
author: satus.sh
tags: [postgres, foreign-keys, graphs, seeding]
draft: false
---

The textbook description of seeding a relational database is: topologically sort the table dependency graph, then insert in order. Parent rows first, child rows next, done. It works exactly until you meet the first schema with a cycle, which—in our experience with private SaaS, marketplace, and audit-heavy schemas—is common enough that no production seed tool can pretend cycles are an edge case. (The structural audit of five public OSS schemas we publish at [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json) found zero FK cycles across 227 foreign keys; cycles primarily live in private codebases where the bootstrap row was always the awkward case.)

This post walks through how [satus](/) detects cycles in the foreign-key graph, why we refuse to disable constraints during a seed run, and the two-pass insert strategy we settled on after burning a few weekends on alternatives.

## Where cycles actually come from

Cycles in a foreign-key graph are almost never an accident. The three patterns we keep seeing:

1. **User ↔ Organization with a "primary owner" pointer.** `organizations.owner_id → users.id`, `users.org_id → organizations.id`. Both columns are NOT NULL on paper, then nullable in practice for the bootstrap row.
2. **Audit tables that point at the actor.** `audit_log.user_id → users.id`, and a `users.last_audit_id → audit_log.id` denormalized cache. Read-heavy workloads love this; seeders hate it.
3. **Self-referential trees with a "root" sentinel.** `categories.parent_id → categories.id` plus `categories.root_id → categories.id`. Technically a cycle of length one on each row, which most off-the-shelf tools handle wrong.

The Postgres catalog will happily let you create all three. `pg_constraint` records the foreign keys ([pg_catalog.pg_constraint](https://www.postgresql.org/docs/current/catalog-pg-constraint.html)) and never warns about cyclical reachability—that's an application-level concern.

## What "the right answer" is not

Before describing what satus does, it is worth naming the three approaches we rejected.

**Disable triggers, insert, re-enable.** `ALTER TABLE … DISABLE TRIGGER ALL` is a sledgehammer that requires superuser, silently bypasses CHECK constraints implemented as triggers, and leaves you owning the correctness of every NOT NULL column. Production roles often cannot run it at all.

**`SET CONSTRAINTS ALL DEFERRED`.** This is the textbook Postgres answer ([SET CONSTRAINTS docs](https://www.postgresql.org/docs/current/sql-set-constraints.html)), and it is the right answer when the schema author actually declared the constraints `DEFERRABLE`. The catch: most teams never override the default. The default is `NOT DEFERRABLE`, and `SET CONSTRAINTS` on a non-deferrable constraint is an error, not a no-op.

**Insert with `ON CONFLICT DO NOTHING` and hope.** This is the YOLO approach. It produces databases that load without errors and fail at the first JOIN.

## What satus does instead

The actual algorithm is unglamorous, which is the point.

```text
1. Read pg_constraint, build a directed graph G where an edge
   (T_a → T_b) means "T_a has a foreign key into T_b".
2. Run Kahn's algorithm. Output the topological order S, plus
   the set of edges E_back that had to be ignored to make S
   acyclic (the "back-edges").
3. For every back-edge (T_a → T_b) on column c, mark c as
   "deferred-fill". The column must be nullable, or the column
   must have a usable DEFAULT, or we abort with a clear error.
4. Pass 1: insert rows in topological order S. Deferred-fill
   columns are inserted as NULL.
5. Pass 2: walk E_back. For each back-edge, run a single
   UPDATE that joins the now-populated child table and fills
   the deferred column with a row id drawn from the realistic
   distribution defined by the profile.
6. Wrap the whole thing in one transaction. If pass 2 cannot
   satisfy a NOT NULL constraint, the transaction rolls back
   and the user sees a structured diagnostic, not a partial seed.
```

Kahn's algorithm is the one from the 1962 paper ([original on ACM](https://dl.acm.org/doi/10.1145/368996.369025)); there is nothing clever in step 2. The interesting work is in step 3, deciding which side of the cycle to defer. The heuristic we use:

```text
prefer to defer the column that:
  1. is nullable,                              else
  2. has a DEFAULT,                            else
  3. participates in fewer downstream FKs,     else
  4. is alphabetically later (deterministic tiebreaker).
```

The tiebreaker matters more than it sounds. Determinism means two runs against the same schema produce the same insert order, which means the same fixture, which means CI is reproducible.

> **Correction (2026-08-28).** Only rule 1 is real. Verified against the shipped
> binary on PostgreSQL 16.13: a `NOT NULL` column with a `DEFAULT` is not
> treated as deferrable and the run exits `10` instead; downstream foreign-key
> count is never computed; and the tiebreaker selects the alphabetically
> *earlier* key, not the later one. The rest of this post, including the
> two-pass algorithm above and the argument against disabling constraints,
> matches the code. Full detail, with the experiments, in a companion post
> published 2026-08-28:
> [The cycle-breaking heuristic we documented and never shipped](/blog/the-cycle-breaking-heuristic-we-never-shipped).

### The three production patterns, scored

The patterns from the opening, with how each one is resolved:

| Cycle pattern                          | Deferred column          | Reason chosen                  | Resolution cost (rows scanned in pass 2) |
| -------------------------------------- | ------------------------ | ------------------------------ | ---------------------------------------- |
| organizations ↔ users (owner_id)       | `organizations.owner_id` | nullable; users has more FKs   | N(organizations)                         |
| audit_log ↔ users (last_audit_id)      | `users.last_audit_id`    | nullable; trivially back-patch | N(users)                                 |
| categories self-ref (root_id)          | `categories.root_id`     | nullable; same table           | N(categories)                            |

Pass 2 is always a single bulk UPDATE per back-edge, never a row-at-a-time loop. The cost is linear in the number of rows in the deferring table, not in the product.

### The shape of the work

The cost structure is what matters here, not specific seconds on one laptop. For a three-cycle schema with `users ↔ organizations`, `users ↔ audit_log`, and `categories` self-referential:

```text
table          pass 1 (insert, topological order)   pass 2 (back-patch UPDATE)
users          bounded by N(users)                  —
organizations  bounded by N(organizations)          bounded by N(organizations)
audit_log      bounded by N(audit_log)              —
categories     bounded by N(categories)             bounded by N(categories)
```

Pass 2 is always a single bulk `UPDATE` per back-edge, never row-at-a-time. Its cost is linear in the number of rows in the **deferring** table, not in the product of the two tables. In the typical SaaS shape—many users, fewer organizations, very many audit rows—pass 2 touches only the organizations table for the `owner_id` back-edge and only the users table for the `last_audit_id` back-edge. The 1M-row audit_log never appears in pass 2 because no back-edge defers onto it.

That property is the whole reason this approach is viable on schemas with cycles and millions of rows: the back-patch work scales with the smaller side.

## Why we will not "just turn off constraints"

This comes up in every other support ticket, so it gets its own section.

When the seed run finishes, the database has to be **observationally indistinguishable from a database that was filled by your application running normally**. If satus disables constraints and re-enables them at the end, two bad things happen:

- A failed pass 2 can leave the database in a state where constraints get re-enabled over invalid rows. Postgres will accept this; the next `pg_dump` and restore will fail.
- Validation logic implemented as triggers (very common for audit columns and cross-row invariants Postgres CHECK cannot express) gets silently bypassed, which means the seeded fixture lies about what real inserts look like.

The whole point of schema-aware seeding is that the data passes every constraint the application would have passed it through. The moment a tool starts disabling things, it has stopped being a seeder and started being a `pg_restore` for fake data.

## Where this fits in satus

The cycle handling described here is part of the default planner; there is no flag to enable. Generate seed data for your schema with:

```bash
satus generate --profile saas
```

The [quickstart](/quickstart) shows the full setup. The [saas-subscriptions profile](/profiles#saas-subscriptions) is the one we built specifically to exercise cycles, so it is a good first run if you want to see the planner do real work.

## References

- PostgreSQL documentation, [Constraints (foreign keys, DEFERRABLE)](https://www.postgresql.org/docs/current/ddl-constraints.html).
- PostgreSQL documentation, [SET CONSTRAINTS](https://www.postgresql.org/docs/current/sql-set-constraints.html).
- PostgreSQL documentation, [pg_catalog.pg_constraint](https://www.postgresql.org/docs/current/catalog-pg-constraint.html).
- Kahn, A. B. (1962). [Topological sorting of large networks](https://dl.acm.org/doi/10.1145/368996.369025). *Communications of the ACM*, 5(11), 558–562.
- Earlier in this log: [Introducing the satus log](/blog/introducing-the-log).
- The corpus underlying this post's structural counts: [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json) (5 schemas, 151 tables, 227 FKs, Postgres 17).

—the satus.sh team
