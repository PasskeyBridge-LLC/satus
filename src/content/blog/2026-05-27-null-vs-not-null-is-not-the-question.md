---
slug: null-vs-not-null-is-not-the-question
title: How nullable columns affect seed data
description: A support ticket about a nullable column that broke an app. The real question is what NULL means to your code, and Postgres gives you three answers, not two.
date: 2026-05-27
author: satus.sh
tags: [postgres, null, semantics, seeding]
draft: false
---

> **Editor's note (2026-07-16):** Sections that reference a `medical-booking` profile describe design intent from spring 2026. The shipped CLI (v0.3.5) ships `saas`, `ecommerce`, and `b2b` prompt profiles; see [/profiles](/profiles). The NULL-vs-NOT-NULL argument stands independent of that profile detail.



A user filed a bug last week. Paraphrased: *"satus filled a nullable column with realistic values and my app crashed in production-shaped tests. The column is nullable, why is your tool inventing data for it?"* The column was `users.deleted_at`. The app treated `NULL` as "active" and any non-null timestamp as "soft-deleted". satus had cheerfully seeded ~30% of the rows with valid timestamps. The test suite then asked the catalog for active users, got two-thirds of what it expected, and 47 tests turned red at once.

The reporter was right that we shipped the wrong default. They were also accidentally illustrating a deeper point: `NULL` versus `NOT NULL` is the wrong axis. The real axis is **what the column's NULL state means to the application that reads it**, and Postgres exposes three encodings for that, not two.

## The three encodings

Most schema reviews assume two states for any column: it has a value, or it is `NULL`. The Postgres catalog disagrees. A column can be:

| Encoding         | Storage when "absent"            | Read by application as              | Catalog signal                          |
| ---------------- | -------------------------------- | ----------------------------------- | --------------------------------------- |
| **Nullable**     | `NULL`                           | "unknown" *or* a domain sentinel    | `attnotnull = false`, no default        |
| **Defaulted**    | the `DEFAULT` expression's value | a real value the app never wrote    | `attnotnull = false/true`, `atthasdef`  |
| **Generated**    | computed from other columns      | derived, never authored by the app  | `attgenerated = 's'` (stored)           |

Generated columns ([PostgreSQL docs: Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html)) landed in Postgres 12 and remain under-used in practice—a structural audit of five public OSS schemas covering 1,095 columns ([`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json)) found zero generated columns. They are the answer to a surprising number of seeding bugs, and we get to them at the end.

The bug from the opening was a category error between the first two rows of that table. `deleted_at` is nullable in the catalog, but in the application's mental model it is a **defaulted column whose default is NULL**. Those are not the same column.

## Why "nullable" is not a signal

The mistake satus made was treating "is the column nullable?" as the entire question. In hindsight the heuristic was naive: if `attnotnull = false` and there is no `DEFAULT`, generate a value with the column's distribution `frac_null` of the time, where `frac_null` was a profile-wide constant.

That heuristic is fine for `users.middle_name` and wrong for `users.deleted_at`. Both look identical to the catalog:

```sql
-- both columns produce identical pg_attribute rows
ALTER TABLE users ADD COLUMN middle_name text;
ALTER TABLE users ADD COLUMN deleted_at  timestamptz;
```

`pg_attribute` records `attnotnull`, `atthasdef`, and `attgenerated`. It does not record *intent*. The information that distinguishes "unknown middle name" from "this user is alive" lives only in the application code, and no amount of catalog introspection will recover it.

What the catalog does record, and what we now lean on much harder, is the **shape of the column relative to its siblings**. Three signals turn out to carry most of the intent:

```text
signal                              evidence in catalog / stats
─────────────────────────────────── ─────────────────────────────────────
name suffix matches a sentinel set  attname LIKE '%_at' AND atttypid =
  (deleted_at, archived_at,           timestamptz; OR attname IN
  closed_at, banned_at, …)            ('archived','is_deleted','closed')

partial index uses the column as    pg_index.indpred references attnum
  a predicate                         AND uses IS NULL / IS NOT NULL

column appears in a CHECK that      pg_constraint.conbin references it
  treats NULL as a state              AND consrc contains 'IS NULL'
```

When any of these three fires, satus treats the column as a **defaulted-to-NULL state flag** and overrides `frac_null` to a profile-controlled value that is much closer to 1.0—typically 0.95 to 0.99 for soft-delete flags, because in the long run most rows in a healthy table are not deleted.

## A heuristic, not a guarantee

We were initially tempted to make the rule a guarantee: *if the column smells like a state flag, always seed it 100% NULL*. We backed off for two reasons.

First, fixtures that test the deleted state are exactly the fixtures that should contain deleted rows. The 47 broken tests in the opening ticket were the *interesting* tests; the rest of the suite was happy. A flat 100% NULL would have moved the failure from "too many soft-deletes" to "no soft-deletes in the deleted-user E2E test", and someone would have filed the inverse ticket the next day.

Second, "smells like" is a heuristic. The reverse case, a column called `closed_at` that is actually a real timestamp with no special semantics, exists. We have seen it in trading systems where every order has a close time and `NULL` truly means "still open" in the Postgres sense, *and* the application reads it that way without surprise. In that schema the original 30%-non-null default was correct.

The resolution is a profile-tunable knob with a name that admits it is a heuristic. From the `saas-subscriptions` profile:

```text
state_flag_columns:
  match:
    - name_suffix: [_at, _on]
      type: [timestamptz, timestamp, date]
    - name_glob: [is_*, has_*]
      type: [boolean]
  frac_null: 0.97          # 97% of rows are NULL = "not in that state"
  except:                  # explicit override list
    - orders.closed_at     # this one is real, leave it alone
```

Two-line YAML, one bug class avoided.

## The third option: generated columns

If you control the schema, generated columns ([PostgreSQL docs](https://www.postgresql.org/docs/current/ddl-generated-columns.html)) eliminate the entire question for derived state. A stored generated column is *uninsertable*. satus refuses to write to it, the application cannot write to it, and the value is always consistent with its inputs. The catalog signals this with `attgenerated = 's'`, which is unambiguous in a way that "nullable with no default" is not.

The pattern we recommend in customer schema reviews:

```sql
-- BEFORE: state encoded in a nullable column the app sets by hand
ALTER TABLE users ADD COLUMN status text;  -- 'active' | 'deleted' | NULL?

-- AFTER: state derived from the underlying timestamp
ALTER TABLE users
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN is_active boolean
    GENERATED ALWAYS AS (deleted_at IS NULL) STORED;
```

Now there is exactly one place that records the soft-delete event (`deleted_at`), exactly one place the app reads to check liveness (`is_active`), and they cannot drift. Indexes on `is_active` work. Foreign keys can target it. satus seeds `deleted_at`, ignores `is_active`, and the resulting fixture matches what the application would produce.

The Postgres wiki has a related cautionary list ([Don't Do This](https://wiki.postgresql.org/wiki/Don%27t_Do_This)) that touches on a few NULL anti-patterns. The deeper rabbit hole is C. J. Date's well-known critique that SQL has, depending on how you count, three- or four-valued logic ([Null (SQL) on Wikipedia](https://en.wikipedia.org/wiki/Null_(SQL))). Real applications do not run on three-valued logic; they run on whatever the application code reduces NULL to. Generated columns let you write that reduction down once.

## What changed in satus

Concretely, since v0.1.1:

- `frac_null` is no longer a single global. It is per-column, with the heuristics above as defaults and explicit profile overrides.
- The dry-run planner (`satus plan`) prints every column it flagged as a state-flag, with the signal that fired, so the override list is discoverable instead of buried.
- Generated columns are detected via `pg_attribute.attgenerated` and skipped in pass 1 entirely. Previous versions silently wrote `NULL` and relied on the database to compute the right value, which works but produces noisier diffs in `INSERT` logs.

Distribution of `frac_null` overrides we have ended up shipping, across the three built-in profiles:

```text
profile              # state-flag    median frac_null    range
                       columns hit
saas-subscriptions   12              0.97                0.90 – 0.995
medical-booking      7               0.94                0.85 – 0.99
ecommerce            9               0.96                0.88 – 0.99
```

`medical-booking` skews lower because more of its "state" columns are genuinely populated (appointments get `checked_in_at`, `seen_at`, `discharged_at` in sequence and the long tail of completed visits dominates).

## The shorter version

NULL is not a value, and "nullable" is not a property of an application, only of a column. Before you ask whether satus should fill a column, ask what the application code does when it reads NULL there. If it reads NULL as "absent information", a sparse distribution is correct. If it reads NULL as "this row is in state X", you want the state, not the absence, and the catalog cannot tell you which it is. Tell the seeder explicitly. Or, better, tell Postgres explicitly and use a generated column so the question stops being askable.

## References

- PostgreSQL documentation, [Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html).
- PostgreSQL documentation, [Default Values](https://www.postgresql.org/docs/current/ddl-default.html).
- PostgreSQL documentation, [Comparison functions and operators (IS NULL)](https://www.postgresql.org/docs/current/functions-comparison.html).
- PostgreSQL documentation, [pg_catalog.pg_attribute](https://www.postgresql.org/docs/current/catalog-pg-attribute.html).
- PostgreSQL wiki, [Don't Do This](https://wiki.postgresql.org/wiki/Don%27t_Do_This).
- Wikipedia, [Null (SQL)](https://en.wikipedia.org/wiki/Null_(SQL)).
- Earlier in this log: [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild), [Introducing the satus log](/blog/introducing-the-log).

—the satus.sh team
