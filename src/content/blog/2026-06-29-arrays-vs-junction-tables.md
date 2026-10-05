---
slug: arrays-vs-junction-tables
title: "Arrays vs junction tables: when Postgres arrays are a smell"
description: Postgres array columns are tempting, occasionally correct, and usually a junction table waiting to happen. A field guide to the three cases where arrays win and the four where they don't.
date: 2026-06-29
author: satus.sh
tags: [postgres, modeling, seeding]
draft: false
---

Postgres ships native array types, GIN indexes on those arrays, and a polished operator vocabulary (`@>`, `&&`, `ANY`, `unnest`). It is one of the things Postgres does that almost no other production relational engine does at this level of polish. So engineers reach for `text[]` for tags, `uuid[]` for member lists, `int[]` for role bitmaps, and the column ships before anyone has asked the question the column should have answered first: *is this set ever joined against another table?*

That question is the whole post. If the answer is no, an array is often the right call. If the answer is yes, you have written a foreign key with no constraint, no index that the planner will use the way you think it will, and no `ON DELETE` behavior. You have, in the language we used in [JSONB columns that are secretly relational](/blog/jsonb-that-is-secretly-relational), built a relation the catalog cannot see.

## Three cases where the array is actually right

A `text[]` (or `int[]`, or domain enum array) earns its place when **all three** of the following hold:

1. The element values are scalar and self-contained. Nothing inside the array references a row in another table.
2. The set is small and bounded, or grows only with the parent row's natural lifecycle. You are not going to want a histogram of element frequency across the whole table.
3. You read the whole array every time you read the row, and you mutate it through the parent (`UPDATE parent SET tags = ...`), not through child-level operations.

The cleanest live example we have in the corpus is pagila's `film.special_features text[]` ([`pagila-schema.sql`](https://github.com/devrimgunduz/pagila/blob/master/pagila-schema.sql)). The column holds a handful of category strings ("Trailers", "Commentaries", "Deleted Scenes", "Behind the Scenes") per film. The values are not rows in another table, the set never grows beyond a fistful of entries, and the query pattern is "load a film, read its features." A junction table here would be five rows of overhead per film for no analytical or integrity benefit.

Two other shapes that legitimately want an array:

- **Ordered, opaque sequences.** Vector embeddings (`vector(1536)`, which is array-shaped internally), per-row event timestamps, ordered preference lists. Order matters, the elements are not entities elsewhere, and decomposing into a child table forces you to invent a `position` column you will then have to keep contiguous.
- **Small, write-rare label sets that you query with set operators.** Things you'd cover with a partial GIN index and `WHERE tags @> ARRAY['archived']`. The set fits in a page, the table is read-heavy, and you never join the tag back to anything.

That's the honest list. Everything else gets harder than it needs to be.

## Four smells that mean it should have been a junction table

The smells below are not theoretical. We see them every week, in every flavor of "we'll fix the data model later." They share a pattern: someone wanted set membership without writing two extra tables, and the convenience of `tags text[]` outran the question of what queries the application would eventually run against it.

### Smell 1: the elements are foreign keys in disguise

```sql
CREATE TABLE comment_thread (
  id           uuid PRIMARY KEY,
  participants uuid[]  -- every UUID is supposed to exist in profile.id
);
```

There is no constraint that says so. Delete a profile and the array silently keeps a dangling reference. Add a profile and there is no way to ask "which threads include this profile" without `WHERE participants @> ARRAY[$1]::uuid[]` and a GIN index—which works, but does not give you a foreign key, does not give you `ON DELETE CASCADE`, and does not let `EXPLAIN` show you a clean join plan. We covered the JSONB equivalent of this in [JSONB columns that are secretly relational](/blog/jsonb-that-is-secretly-relational); the array version has exactly the same problem with slightly better ergonomics.

If the elements name rows in another table, write the junction. The two extra tables pay for themselves the first time someone asks "list every thread that includes profile X" or, worse, "delete profile X cleanly."

### Smell 2: you need per-element metadata

The day someone asks "when was this tag added?" or "who added this member?" or "is this role currently active, or expired?" the array is over. You cannot attach a timestamp, an actor, or a status to a `text[]` element without serializing structure into the string (`"role:admin:added=2025-01-04"`), which is the worst of all worlds.

A junction table makes this trivial:

```sql
CREATE TABLE thread_participant (
  thread_id  uuid    NOT NULL REFERENCES comment_thread(id) ON DELETE CASCADE,
  profile_id uuid    NOT NULL REFERENCES profile(id)        ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  added_by   uuid    REFERENCES profile(id),
  PRIMARY KEY (thread_id, profile_id)
);
```

If you suspect within a year you will want any per-element metadata, do not start with an array. Migrating later is not free: you have to keep the array and the table in sync during the cutover or accept a window where the new metadata does not exist for old rows.

### Smell 3: you need to query across rows by element

"How many films have 'Trailers'" is fine against `film.special_features` because there are 1,000 films. "How many users have the `beta-pricing-v2` feature flag" against `users.feature_flags text[]` on a million-row table is fine for one query and miserable for the dashboard that wants to break it down by signup cohort, plan, and country.

The moment you want `GROUP BY element`, you are calling `unnest(arr)` on every row in the table. With a junction table, `feature_flags(user_id, flag)` gives you a real B-tree index on `flag`, real cardinality statistics, real partial indexes per flag, and a query plan the planner can actually optimize. GIN on the array can answer membership questions; it cannot turn the array into a column the planner reasons about as a relation.

The asymmetric workload—write rarely, read in many ways—is exactly what relational decomposition was invented for. Arrays serve the opposite workload: read whole, write whole, never aggregated.

### Smell 4: you need uniqueness, ordering, or referential integrity inside the set

Postgres arrays do not enforce element uniqueness. `tags text[] = ARRAY['x', 'x']` is a valid value. If your application contract says "each tag appears at most once," the database does not know that, and you will at some point ship a bug that puts a duplicate in. The standard workaround—`CHECK (cardinality(tags) = cardinality(ARRAY(SELECT DISTINCT unnest(tags))))`—works and is the kind of constraint nobody remembers to write at table-creation time.

Junction tables enforce uniqueness for free via the composite primary key. They enforce referential integrity for free via the foreign keys. They enforce ordering, if you need it, via an explicit `position int NOT NULL` column with a unique constraint per parent. Every one of those guarantees you have to bolt onto an array column with a `CHECK` that is brittle, slow, or both.

## The borderline case: tags

The single most common array column we see is some variant of `tags text[]` or `tags varchar[]`. listmonk uses it on both [`lists.tags`](https://github.com/knadh/listmonk/blob/v3.0.0/schema.sql) and [`campaigns.tags`](https://github.com/knadh/listmonk/blob/v3.0.0/schema.sql), with no related `tag` table and no junction. For an operator-facing newsletter tool where tags are free-form strings, never aggregated across the whole table, and only ever read together with the parent list or campaign, this is a defensible choice. Three things to ask before you accept it on your own schema:

- **Are tags ever first-class entities?** Do you want a tag detail page, a rename operation that updates every reference, a tag-level permission? If yes, write a `tag` table and a junction.
- **Are tags queried across rows by tag value?** "Show me all campaigns tagged `q3-launch`" against an array column works via GIN, but "give me the top 20 tags by campaign count" is a full-table `unnest` aggregation. If that is a real product requirement, the junction wins on day one.
- **Are tags shared with another system?** If the same tag taxonomy lives in your CRM, your analytics pipeline, and a half-finished tagging UI, the array column will drift from each of them. The junction is the synchronization point.

If all three answers are no—operator types in free-form strings, never aggregated, never shared—the array is fine. We are not recommending you migrate listmonk. We are recommending you ask the three questions before you copy the pattern into a schema where the answers are different.

## What this means for seed data

Two practical observations from our side of the fence.

First, every seed tool we have looked at, including satus today, treats array-typed columns shallowly. In [`packages/cli/src/generate/schema.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/schema.ts), the JSON-schema mapping switches on `udtName` and does not branch on Postgres's array convention (the `_text`, `_varchar`, `_uuid` udt names that mark an array). Array columns fall through to the default `string` mapping and the model emits a single string instead of a JSON array. The insert path then either fails on type mismatch or coerces a one-element array depending on the driver. We are tracking this under the v0.4 introspection pass; until it ships, the honest workaround for a schema with array columns is a per-column override in `satus.config.json` (the same escape hatch documented in the JSONB post).

Second, if you have already written the junction table, seeding is straightforward. Generate the parents, generate the children, generate the junction rows by sampling pairs with whatever cardinality distribution your domain wants. Every step is a row insert against a table the catalog describes. If you have written the array, the seed tool has to invent both the array length distribution and the element values, with no schema-level hint about which is correct. Junction tables are not just easier to query; they are easier to populate honestly.

## Decision checklist

Use this before merging the column.

```text
Question                                                      Array OK?   Junction
────────────────────────────────────────────────────────────  ──────────  ──────────
Do elements reference rows in another table?                  no          yes
Will you ever attach metadata to an element?                  no          yes
Will you ever GROUP BY element across many rows?              no          yes
Do you need element-level uniqueness or ordering enforced?    no          yes
Is the set bounded, scalar, and read-whole?                   yes         no
Is order intrinsic to the value (vectors, sequences)?         yes         no
```

Three "no"s on the bottom two rows, or one "yes" on the top four, is your signal. Arrays are not wrong; they are narrow. The narrowness is the whole feature.

## References

- pagila, `film.special_features`—[`pagila-schema.sql`](https://github.com/devrimgunduz/pagila/blob/master/pagila-schema.sql)
- listmonk, `lists.tags` and `campaigns.tags`—[`schema.sql`](https://github.com/knadh/listmonk/blob/v3.0.0/schema.sql)
- Postgres arrays, language reference—[Postgres 17 §8.15](https://www.postgresql.org/docs/17/arrays.html)
- GIN indexes on arrays—[Postgres 17 §70](https://www.postgresql.org/docs/17/gin.html)
- satus column-type mapping (today)—[`packages/cli/src/generate/schema.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/schema.ts)
- Companion post on the JSONB version of the same anti-pattern—[JSONB columns that are secretly relational](/blog/jsonb-that-is-secretly-relational)
