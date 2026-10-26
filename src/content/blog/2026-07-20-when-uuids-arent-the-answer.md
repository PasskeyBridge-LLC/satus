---
slug: when-uuids-arent-the-answer
title: "When UUIDs aren't the answer"
description: UUIDv7 reopened the primary-key debate. What v7 fixes, what it doesn't, and when bigserial or a composite key is still the right choice in Postgres.
date: 2026-07-20
author: satus.sh
tags: [postgres, primary-keys]
draft: false
---

The default answer to "what should the primary key be?" has drifted, in the last two years, from `bigserial` to `uuid`, and then, since [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562) shipped in May 2024 and PostgreSQL 18 added a built-in [`uuidv7()`](https://www.postgresql.org/docs/18/functions-uuid.html) function, from `uuid` to `uuid v7`. The migration is often justified in a single sentence: "v7 is time-ordered, so it fixes the index locality problem." That is true, and it is also not the whole picture. This post walks through what a UUID actually costs a Postgres schema, what v7 does and does not fix, and the two situations where `bigserial` or a composite key remains the honest choice.

## The short version

UUIDv4 is 16 bytes of random data, which doubles the on-disk size of every primary key and every foreign key relative to a `bigint`, and scatters btree inserts across the leaf pages of every index the key participates in. UUIDv7 keeps the 16 bytes but restores insert locality by placing a Unix-millisecond timestamp in the high-order bits, so it eliminates most of the write-amplification argument against random UUIDs. It does not eliminate the storage argument, it does not eliminate the human-legibility argument, and it does not make composite keys obsolete. Choose the key that reflects what the row actually is, then use `bigint` when the row is naturally sequential and internal, `uuidv7` when it needs to be globally unique or externally shareable, and a composite when the row's identity is a pair.

## What a UUID costs, in bytes and pages

A `bigint` is 8 bytes. A `uuid` is 16 bytes. In isolation the extra 8 bytes are unremarkable, but a primary key is never in isolation. Every foreign key that references it stores the full value, every btree index on the key or on any composite that includes it stores the value in every leaf and every internal page, and every row version that Postgres keeps around because of MVCC stores it again. On a schema of any size the primary-key type is a multiplier on total index size, not an additive cost.

The [PostgreSQL data-types reference](https://www.postgresql.org/docs/current/datatype-uuid.html) gives the storage for `uuid` as 16 bytes and the [numeric-types page](https://www.postgresql.org/docs/current/datatype-numeric.html) gives `bigint` as 8. A btree page is 8 kB. Doubling the key width roughly halves the fan-out of internal pages and adds a proportional amount to every leaf entry's key portion, so an index with a UUID key is measurably larger and slightly deeper than the equivalent `bigint` index. That is the storage tax, and it applies to v4 and v7 equally.

## The insert-locality problem, and what v7 fixes

The second cost of a UUID primary key, historically the more expensive one, is a runtime tax rather than a storage one. A btree stores keys in sorted order. When new rows arrive with keys drawn uniformly at random, as v4 UUIDs are, each insert lands on a different leaf page. On a busy table that means the working set of "recently written leaf pages" is not a hot handful at the right edge of the index (as it is for `bigserial`), but effectively the whole index. Shared buffers churn, WAL traffic rises, and vacuum has more work per row.

UUIDv7 changes exactly this. [RFC 9562 §5.7](https://www.rfc-editor.org/rfc/rfc9562#section-5.7) defines the layout: 48 bits of Unix millisecond timestamp in the high-order position, then 4 bits of version, 12 bits of pseudorandom data, 2 bits of variant, and 62 more bits of random. Sort order tracks generation time, so a v7-keyed btree behaves like a `bigserial` btree from the buffer-pool's point of view: new inserts concentrate on the right edge, old pages stay quiet.

That is the entire fix. It is a real fix, and it is worth taking. It does not change the storage numbers, it does not make the key smaller, and it does not make the key more meaningful to a human reading a log line.

## Where bigserial still wins

There are two situations where a schema is honestly better served by `bigserial` (or `bigint generated always as identity`, which is the modern equivalent, see [`CREATE TABLE`](https://www.postgresql.org/docs/current/sql-createtable.html)):

The row is internal and never leaves the database. Enum-like lookup tables, join tables that no client ever references directly, materialised aggregates. Nothing outside Postgres needs to name these rows, so the "globally unique across systems" property of a UUID pays for nothing. The 8-byte key and the smaller indexes are a straight win.

Ordering matters and is part of the contract. `serial` and `bigserial` are strictly monotonic within a session, and near-monotonic across a cluster. Applications that want to page through rows in insertion order, or that use the primary key as a tie-breaker in a "latest N" query, get that behaviour for free. UUIDv7 is approximately time-ordered, not strictly, because two v7 values generated in the same millisecond by the same or different processes can sort in either order. The RFC is explicit that clients that need a total order must add their own sub-millisecond tiebreaker; see [§6.2 "Monotonicity and Counters"](https://www.rfc-editor.org/rfc/rfc9562#section-6.2).

If either of those applies, "we use v7 for everything" is a policy that costs storage and complexity for no gain on that table.

## Where a composite key is still the honest answer

The other case a "UUID everywhere" policy hides is the row whose identity is genuinely a pair. Junction tables between two entities (a `team_members(team_id, user_id)` row is the pair, not a synthetic id), append-only period tables keyed on `(entity_id, valid_from)`, multi-tenant tables where every row is scoped by `tenant_id` and the natural key is `(tenant_id, external_id)`. Adding a surrogate `id uuid` column to these tables does not remove the composite, it just moves it: the `UNIQUE (team_id, user_id)` constraint has to exist anyway, so the surrogate is a second index that carries no information the first index does not already carry.

The Postgres manual has been consistent on this for a long time. The [`CREATE TABLE` reference](https://www.postgresql.org/docs/current/sql-createtable.html) allows table-level `PRIMARY KEY (a, b)` because that is often the right shape. A composite primary key on a junction table is one row of DDL and it makes the intent of the table legible to any future reader.

## Quick decision table

| Row shape                                                | Recommended key                                    |
| -------------------------------------------------------- | -------------------------------------------------- |
| Internal lookup, join, or aggregate (never leaves the DB) | `bigint generated always as identity`              |
| User-facing, externally shared, or federated across systems | `uuid` with `uuidv7()` default                     |
| Insertion order is part of the contract                  | `bigint` identity, or `(uuidv7, bigint tiebreak)`  |
| Junction of two entities                                 | Composite `PRIMARY KEY (a_id, b_id)`               |
| Bitemporal / append-only history                         | Composite `PRIMARY KEY (entity_id, valid_from)`    |

## What this means for seeding

A seeder has to pick primary-key values that respect whatever the schema chose. If the column is `bigint identity`, the right thing is to let the sequence assign; if the column is `uuid default uuidv7()`, the right thing is to let the default fire; if the column is `uuid` with no default, the seeder has to generate values in the same format the application would. Substituting a v4 into a table the application populates with v7 is a subtle wrong answer: the seed rows will sort to the left of every subsequently inserted row, which can cause a "latest N" query in a dev environment to return the seeded rows first for the wrong reason.

satus reads the column default (through [`pg_attrdef`](https://www.postgresql.org/docs/current/catalog-pg-attrdef.html), see the earlier post on [what pg_dump doesn't tell you](/blog/what-pg-dump-doesnt-tell-you)) and honours it: if the column defaults to `uuidv7()`, the seeder emits `DEFAULT` and lets the server fill the value in, so the ordering property of the production key is preserved in the seed set. When there is no default and the column type is `uuid`, satus generates v7 values by default rather than v4, on the same reasoning. The three [built-in profiles](/profiles) all follow this rule.

## Summary

UUIDv7 removes the argument that was doing most of the work against random UUIDs: insert locality is back. It does not remove the storage cost, it does not remove the readability cost, and it does not make `bigint` obsolete for internal rows or composite keys obsolete for pair-shaped rows. Choose the key that describes the row. Then, if you have chosen a UUID, choose v7.

## References

- IETF, [RFC 9562: Universally Unique IDentifiers (UUIDs)](https://www.rfc-editor.org/rfc/rfc9562), including [§5.7 UUID Version 7](https://www.rfc-editor.org/rfc/rfc9562#section-5.7) and [§6.2 Monotonicity and Counters](https://www.rfc-editor.org/rfc/rfc9562#section-6.2).
- PostgreSQL 18 documentation, [UUID Functions](https://www.postgresql.org/docs/18/functions-uuid.html) (`uuidv4()`, `uuidv7()`).
- PostgreSQL documentation, [UUID Type](https://www.postgresql.org/docs/current/datatype-uuid.html) and [Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html).
- PostgreSQL documentation, [`CREATE TABLE`](https://www.postgresql.org/docs/current/sql-createtable.html) (identity columns, composite primary keys).
- PostgreSQL documentation, [`pg_attrdef`](https://www.postgresql.org/docs/current/catalog-pg-attrdef.html) catalog.
