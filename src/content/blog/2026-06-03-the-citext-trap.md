---
slug: the-citext-trap
title: The CITEXT trap in Postgres unique indexes
description: A seed job asked for 10,000 users and inserted 6,200: a CITEXT unique index folded Alice and alice into one row. What CITEXT does and what satus generates.
date: 2026-06-03
author: satus.sh
tags: [postgres, citext, unique, collations, seeding]
draft: false
---

A user opened a ticket last week: *"satus said it inserted 10,000 rows. `SELECT count(*) FROM users` returns 6,200. What happened to the rest?"* Postgres had not lost anything. The `users.email` column was declared `CITEXT`, the column had a `UNIQUE` constraint, and the seeder had cheerfully generated names like `Alice.Smith@example.com` and `alice.smith@example.com` from the same distribution. To the unique index those are the same value. About 38% of the inserts hit a conflict and were swallowed by the `ON CONFLICT DO NOTHING` clause that satus uses to keep partial runs idempotent. The math worked out exactly.

That was the visible bug. The bigger trap is that the Postgres documentation itself now tips readers toward nondeterministic ICU collations (introduced in Postgres 12) over the `citext` extension, and almost every schema that "needs case-insensitive text" has quietly stopped using it without telling anyone. We looked.

## What CITEXT actually is

`CITEXT` is a contrib extension ([PostgreSQL: citext](https://www.postgresql.org/docs/current/citext.html)) that ships a single data type: a `text`-shaped value whose comparison operators are case-insensitive. The implementation is a thin wrapper that lower-cases both operands before comparing. That has three consequences worth naming up front, because the readme buries them under usage examples.

1. **Equality is case-insensitive everywhere.** `=`, `<`, `IN`, `GROUP BY`, and any unique index on the column all fold case. There is no way to ask "are these two values byte-equal?" without an explicit cast back to `text`.
2. **The folding is not Unicode-aware by default.** `LOWER()` in stock Postgres uses libc's locale rules; on most installations that means ASCII case folding plus whatever the database's collation happens to do. `İ` (Turkish capital I with dot) and `i` are not equal under CITEXT on a `en_US.UTF-8` cluster. They are equal under a Turkish locale. The extension's docs flag this explicitly.
3. **It is not free.** Each comparison calls `lower()` on both sides. A unique index on a CITEXT column is, internally, an index on the lower-cased value. Inserts pay the lowering cost on every row; lookups pay it on every query.

None of this is wrong, exactly. It is a small, sharp tool that does what it says. The trap is that "case-insensitive text" sounds like a property of the column, and people reach for it without specifying *whose* case rules and *which* operations they wanted folded.

## What the docs now recommend instead

Postgres 12 added nondeterministic ICU collations ([PostgreSQL: Collation Support](https://www.postgresql.org/docs/current/collation.html#COLLATION-NONDETERMINISTIC)). The relevant paragraph is short enough to paraphrase: a nondeterministic collation can declare its own equality rules, including case-insensitivity and accent-insensitivity, and those rules apply to any `text` column that uses the collation. No extension required, ICU rules instead of libc, and the comparison is integrated with the planner rather than bolted on top.

The replacement pattern looks like this:

```sql
CREATE COLLATION case_insensitive (
  provider    = icu,
  locale      = 'und-u-ks-level2',  -- "und" = root locale, ks-level2 = ignore case
  deterministic = false
);

CREATE TABLE users (
  id    bigint generated always as identity primary key,
  email text COLLATE case_insensitive NOT NULL UNIQUE
);
```

Two practical differences from CITEXT:

| Concern                       | CITEXT                                  | Nondeterministic collation              |
| ----------------------------- | --------------------------------------- | --------------------------------------- |
| Source                        | contrib extension (`CREATE EXTENSION`)  | core, no extension needed since PG 12   |
| Unicode rules                 | libc + ASCII fold via `lower()`         | ICU; predictable across platforms       |
| Pattern matching (`LIKE`)     | works                                   | not supported on nondeterministic cols  |
| Per-column vs. per-database   | per-column type choice                  | per-column collation, mix freely        |
| Index on the column           | unique works, FTS-style ops do not      | unique works, `LIKE` does not           |

The `LIKE` row is the one that bites teams migrating off CITEXT. If your app does `WHERE email LIKE 'admin@%'`, that query stops planning when the column moves to a nondeterministic collation. The fix is usually a separate functional index on `lower(email)`, which is the pattern the rest of the Postgres world has been quietly using all along instead of either CITEXT or nondeterministic collations.

## What real schemas actually do

We ran a structural audit of five open-source Postgres schemas (listmonk, lemmy, powerdns, penpot, pagila) on Postgres 17 covering 151 user tables and 1,095 columns. The full numbers are in [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json). Two findings are directly relevant to this post:

```text
metric                                           value across 5 schemas
─────────────────────────────────────────────── ───────────────────────
total columns                                    1,095
columns whose udt_name is 'citext'                   0
text/varchar/bpchar columns named like '%email%'     9
```

Zero CITEXT columns across all five schemas, including the two that ship explicit user-account tables with email addresses. Nine email-named columns, all of them plain `text` or `varchar`. None of these schemas opted into CITEXT, and only one (the schemas we cannot inspect because they are private) is using nondeterministic ICU collations as far as we can tell from public migration files in the broader OSS Postgres ecosystem—it remains rare.

The dominant pattern in the wild is the third option: keep the column as plain `text`, store the case the user typed, and enforce uniqueness with a functional unique index on `lower(email)`. That preserves `LIKE`, makes the comparison explicit at every call site, and never imports an extension. It is also the pattern that the satus seeder has always handled correctly, because there is no special type to detect, just a `UNIQUE (lower(email))` constraint that the planner introspects like any other expression index.

## The seeding bug, more carefully

Returning to the opening ticket. The customer's schema had CITEXT, and satus had not noticed. The relevant slice of the schema:

```sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id        bigint generated always as identity primary key,
  email     citext  NOT NULL UNIQUE,
  full_name text    NOT NULL
);
```

Pre-v0.2.0, satus walked `information_schema.columns`, saw `data_type = 'USER-DEFINED'` and `udt_name = 'citext'`, treated the column as "some custom type, fall back to text", and asked the LLM-backed generator for realistic email-shaped strings. The generator did its job. It produced strings drawn from a name pool with random casing, because real email lists in the wild contain both `Alice.Smith@…` and `alice.smith@…` and the profile's stated goal was realism.

Postgres then deduplicated on insert. The unique index on `email` folded case, the `ON CONFLICT DO NOTHING` clause absorbed the conflict, and the visible row count came in low. The user saw "satus is dropping rows". satus was not dropping rows; the database was, and it was correct to.

The fix in v0.2.0 is two changes that together close the gap:

- **Detection.** During introspection, satus now checks `pg_type.typname IN ('citext')` for every column and records a `case_insensitive_unique = true` flag whenever that type participates in a unique constraint. The same flag is set for columns whose type uses a nondeterministic collation (`pg_collation.collisdeterministic = false`) and for columns referenced by a functional unique index that calls `lower()` or `upper()`.
- **Generation.** When the flag is set, the generator draws from a case-normalized pool and applies the column's intended canonical form (`lower()` for the email cases, profile-configurable otherwise) before checking the in-memory uniqueness ledger that satus maintains for the run. The on-disk row keeps whatever casing the generator produced; the uniqueness check sees the folded form.

The result, on the customer's schema:

```text
                                pre-v0.2.0       v0.2.0
                                ───────────      ──────
requested rows                       10,000      10,000
inserted                              6,213      10,000
silently deduped by index             3,787           0
satus.plan warnings printed               0           1
```

The single warning, for completeness:

```text
satus: column `public.users.email` is CITEXT and participates in a
       UNIQUE index. Generation will normalize case before checking
       uniqueness. To preserve mixed-case input but enforce uniqueness
       on the canonical form, this matches Postgres' own behavior.
```

## The broader recommendation

If you are starting a schema today and want case-insensitive uniqueness on an email or username column, the order of preference we use in customer schema reviews:

1. **`text` with a functional unique index on `lower(col)`.** Works on every Postgres, preserves `LIKE`, makes the case-folding explicit at every site that cares. This is what the OSS schemas we audited do, and it is what satus generates against without any special handling.
2. **`text COLLATE <nondeterministic-icu>` for the column.** Cleaner at the schema level, predictable Unicode rules, but you lose `LIKE` on the column and you take a hard dependency on ICU being available (Postgres builds without ICU exist, especially in older containers).
3. **`CITEXT`.** Only if you are extending a schema that already uses it, or if you have a specific reason to want the extension's `lower()`-based folding behavior. New code should not reach for it; the citext docs themselves contain a Tip recommending nondeterministic collations instead ([PostgreSQL: citext](https://www.postgresql.org/docs/current/citext.html)).

The thing every option has in common, and the thing satus learned the hard way, is that "case-insensitive" is a property of the comparison, not of the data. The row on disk still has the case the user typed. The index, the collation, or the functional expression decides what counts as equal. If your seeder ignores that and treats the column as plain text, the database will silently disagree with it and the disagreement will show up as a count that does not match. The opening ticket was the cleanest possible version of that story. We have since seen it in three other shapes (a `usernames` table, a `tags` table, and a tenancy `subdomains` table) and the resolution is the same in all of them: detect the case-folding contract on the column, fold inside the generator, let the database see only values it has not seen before.

## The shorter version

CITEXT is a real extension, it does what it advertises, and it will collapse `Alice` into `alice` for every operation that touches the column, including the unique index your seeder is inserting against. Postgres 12 and later prefer nondeterministic ICU collations; the broader OSS ecosystem has mostly settled on plain `text` plus a `lower()` functional index. None of these are wrong. All of them require your seed-data tool to know which one the column is using and to fold before it asks the database to accept the row. satus v0.2.0 detects all three shapes and generates accordingly. The pre-v0.2.0 behavior was to trust the column's apparent text-ness and let the database arbitrate, which is the same as letting the database silently drop your test data.

## References

- PostgreSQL documentation, [citext](https://www.postgresql.org/docs/current/citext.html).
- PostgreSQL documentation, [Collation Support](https://www.postgresql.org/docs/current/collation.html), specifically [Nondeterministic Collations](https://www.postgresql.org/docs/current/collation.html#COLLATION-NONDETERMINISTIC).
- PostgreSQL documentation, [Unique Indexes](https://www.postgresql.org/docs/current/indexes-unique.html).
- PostgreSQL documentation, [Indexes on Expressions](https://www.postgresql.org/docs/current/indexes-expressional.html).
- PostgreSQL documentation, [INSERT … ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT).
- Earlier in this log: [Partitioned tables meet RLS, and nobody wins](/blog/partitioned-tables-meet-rls), [NULL vs NOT NULL is not the question](/blog/null-vs-not-null-is-not-the-question), [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild).
- The corpus underlying this post's structural counts: [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json) (5 schemas, 151 tables, Postgres 17).
- See also: [satus profiles](/profiles), [quickstart](/quickstart).

—the satus.sh team
