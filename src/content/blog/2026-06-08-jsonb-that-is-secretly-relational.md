---
slug: jsonb-that-is-secretly-relational
title: JSONB columns that are secretly relational
description: Half the JSONB columns we see are key/value bags. The other half are foreign keys in disguise — arrays of IDs pointing at real rows, with no constraint to prove it. How to tell them apart.
date: 2026-06-08
author: satus.sh
tags: [postgres, jsonb, modeling, seeding]
draft: false
---

A `JSONB` column declares almost nothing about its contents. The catalog tells you the column is `jsonb`, that it is `NOT NULL`, maybe that it defaults to `'{}'` or `'[]'`. After that the schema is silent, and the application owns the meaning. That silence is what makes JSONB useful — and also what makes seeding it correctly the single most error-prone part of generating realistic data for a schema you did not write.

In practice there are two populations of JSONB columns in real Postgres schemas, and they want very different things from a seed generator.

1. **Key/value bags.** Free-form attribute storage. `subscribers.attribs`, a user-profile `props`, a per-event `metadata` blob. The keys are loosely conventional, the values are scalars or short arrays, and nothing inside the JSON refers to another row.
2. **Secretly relational columns.** The JSON contains IDs (or URIs, or composite keys) that point at rows in other tables, with no foreign key constraint to enforce the link. The column is a denormalized relation, written into JSONB because the team wanted set semantics, schemaless evolution, or just a faster path through their ORM.

The first population is easy to fake. The second one is where seed runs silently produce data that looks plausible, passes every constraint Postgres knows about, and then breaks the application the moment a feature joins against it.

## What the corpus shows

We publish a structural audit of five open-source Postgres schemas at [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json). The audit summary does not break out JSONB counts, but the underlying schemas are pinned to specific tags and a direct grep against them is reproducible. Across listmonk v3.0.0, lemmy 0.19.5, powerdns auth-4.9.3, penpot 2.4.3, and pagila (master), three of the five schemas declare JSONB columns; two (powerdns, pagila) declare none. Of the JSONB columns that do exist, the split between bag and relation is roughly even, and the relational ones are not annotated as such in any way the catalog can see.

Three concrete cases worth naming, all verifiable in the upstream sources:

```text
schema     table             column         shape                       relational?
─────────  ────────────────  ─────────────  ──────────────────────────  ────────────
listmonk   subscribers       attribs        free-form attribute bag      no
penpot     comment_thread    participants   set of profile IDs           yes (no FK)
lemmy      activity          data           ActivityPub envelope         yes (URI refs)
```

The penpot example is the cleanest. The `comment_thread` table in penpot's migration [`0031-add-conversation-related-tables.sql`](https://github.com/penpot/penpot/blob/2.4.3/backend/src/app/migrations/sql/0031-add-conversation-related-tables.sql) declares two explicit foreign keys (`file_id`, `owner_id`) and then this:

```sql
CREATE TABLE comment_thread (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_id      uuid NOT NULL REFERENCES file(id) ON DELETE CASCADE,
  owner_id     uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  page_id      uuid NOT NULL,
  participants jsonb NOT NULL,
  -- ...
);
```

`participants` has no constraint. The catalog will tell a seed tool "this is a JSONB column, default permissive object, do whatever you want." But the application code writes it as a JSON set of `profile.id` UUIDs — the relevant line in `comments.clj` is literally `:participants (db/tjson #{profile-id})`. Every UUID inside that array is supposed to exist as a row in `profile`. There is no database-level guarantee that it does, and no `ON DELETE CASCADE` to clean it up when a profile is deleted. The relation lives in the application's head.

The lemmy example is a degree harder. The `activity` table stores an ActivityPub payload as `data jsonb NOT NULL`. ActivityPub envelopes contain fields like `actor`, `object`, `to`, and `cc` whose values are URIs ([ActivityPub §4.5](https://www.w3.org/TR/activitypub/#object-without-create)). On a federated instance many of those URIs resolve to rows on the same Postgres cluster — local users, local communities, local posts. From Postgres's point of view it is a string inside JSON. From the application's point of view it is a foreign key spelled in URL form.

The listmonk case is the negative control. `subscribers.attribs` ([schema.sql](https://github.com/knadh/listmonk/blob/v3.0.0/schema.sql)) is a true bag — declared `JSONB NOT NULL DEFAULT '{}'`, used for whatever per-subscriber attributes the operator wants to track, never queried for cross-table integrity. The same column declaration syntax, the same catalog metadata, completely different semantics.

## Why a generator cannot ignore the distinction

A seed run that treats every JSONB column as an opaque object produces three failure modes against secretly-relational columns. They are progressively worse.

**Failure 1: the JSON parses but the IDs are nonsense.** The generator emits `{"foo": "bar", "n": 42}` for `comment_thread.participants`. The insert succeeds — JSONB takes anything. Nothing inside resembles a UUID, nothing inside resembles a profile, and the first time the application page loads the thread it crashes on a missing key or a type error in the consuming code.

**Failure 2: the JSON parses and looks shaped right, but the IDs are unrelated to anything.** The generator notices the column name `participants`, decides this looks like a list, emits `["uuid-1", "uuid-2"]` with freshly minted UUIDs. The application's "who is on this thread" query joins against `profile` and returns zero rows. The failure mode is silent: no exception, no row count drop, just a feature that quietly shows no participants forever after.

**Failure 3: the JSON looks right and the IDs do exist, but they were chosen without regard to the surrounding rows.** The generator (somehow) picks real `profile.id` values, but at random. The `comment_thread.owner_id` says profile A wrote the thread; `participants` contains profiles X, Y, Z with no relationship to A. The data is consistent at the constraint layer and inconsistent at every higher layer — moderation queries, permission checks, anything that assumes the owner is also a participant. This is the worst case because it looks fine in a quick spot-check and breaks specific feature tests at apparently random places.

The constraint engine cannot catch any of these because there are no constraints. JSON Schema validation in the application can — and frequently does — catch the first one, but it cannot catch the second or third.

## How satus handles JSONB today

We owe this section honesty. As of v0.2.0, satus treats every JSONB column as a permissive object and asks the LLM-backed generator for a plausibly-shaped JSON value. The relevant line is in [`packages/cli/src/generate/schema.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/schema.ts), case `'json' | 'jsonb'` → `{ type: 'object' as const }`. There is no detection for "this JSONB column is secretly an array of foreign keys."

That means satus, today, produces Failure 1 or Failure 2 on penpot's `participants` column — depending on how well the column name primes the generator. It will not produce Failure 3, because it does not know to pick from `profile.id`, so the IDs it invents will not exist. The visible symptom is that the seeded database loads, the threads exist, the thread participant counts are wrong, and nothing crashes until the application actually consults the field.

This is not where we want to land. The roadmap entry that prompted this post is "JSONB shape inference," and the design we are heading toward has three layers.

1. **Catalog-only signals.** Column name (`participant_ids`, `member_ids`, `tags`), default value (`'[]'` strongly implies an array), and `NOT NULL` + array default together suggest "set of something."
2. **Sample-driven signals.** When the target database already contains rows (the common case for staging refreshes — distinct from a from-empty seed), satus can read up to N existing values and infer the JSON shape: array vs. object, scalar element type, UUID-likeness of element values, overlap of element values with the PK columns of other tables in the schema.
3. **Profile overrides.** Customers who know their own schema can declare, in `satus.config.json`, that `comment_thread.participants` is "JSONB array of profile.id" and have satus generate accordingly. This is the escape hatch for cases where the catalog and the sample both fail to reveal the relation.

Layer 1 is cheap and ships first. Layer 2 is the one that actually solves the penpot case, because it catches "this column is full of UUIDs that also appear in `profile.id`" without anyone having to write a config entry. Layer 3 is where this lands long-term, because every team eventually has at least one JSONB column whose meaning lives in a Confluence page nobody updated in two years.

A planned warning, modeled on the [CITEXT one we already emit](/blog/the-citext-trap), will look approximately like this:

```text
satus: column `public.comment_thread.participants` is JSONB. The
       column has no FK constraint, but 100% of sampled values are
       arrays of UUIDs and ≥95% of those UUIDs exist in `public.profile.id`.
       Generation will draw participant UUIDs from existing `profile`
       rows. To disable, set `jsonb.infer = false` in satus.config.json.
```

The warning is the point. JSONB columns are a place where the schema gives the seed tool too little information to be correct silently; the only honest behavior is to surface the inference, name the source table it picked, and let the operator override it.

## What to do today, on a real schema

If you are seeding a database that has JSONB columns you suspect are relational, three steps that work right now without waiting for satus to grow the detection:

1. **Find them.** A one-line query is enough to enumerate every JSONB column in the schema:
   ```sql
   SELECT table_schema, table_name, column_name, column_default
   FROM information_schema.columns
   WHERE udt_name IN ('json', 'jsonb')
     AND table_schema NOT IN ('pg_catalog', 'information_schema')
   ORDER BY table_schema, table_name;
   ```
2. **Sample them.** For each column, `SELECT data FROM <table> WHERE data IS NOT NULL LIMIT 20` is sufficient to see whether the contents are objects with stable keys (bag) or arrays/objects of UUIDs and integers (probably relational). Five minutes per column.
3. **Declare them in `satus.config.json`.** Until the inference layer ships, the supported escape hatch is a per-column generator override. The shape we are stabilizing is:
   ```jsonc
   {
     "tables": {
       "comment_thread": {
         "columns": {
           "participants": {
             "kind": "jsonb_array_of_ids",
             "references": "profile.id",
             "min": 1,
             "max": 5
           }
         }
       }
     }
   }
   ```

The override is the same one Layer 3 of the roadmap will accept, so config you write today carries forward.

## The broader claim

A JSONB column is a foreign key whenever the application treats it as one, regardless of what the constraint catalog says. Seed tools that ignore this produce datasets that look statistically reasonable and fail the moment they meet a feature that joins through the JSON. The fix is not "always sample" or "never sample"; it is to treat JSONB shape inference as a first-class step of introspection, surface it as an explicit warning the way we surface CITEXT and unique-constraint folding, and give the operator a config-level override for the cases where the inference is wrong.

That is the work between v0.2.0 and the next minor release. Until it ships, the honest workaround is the three-step process above. The pattern is real, it is common in private schemas more than in OSS ones, and naming it is the prerequisite for fixing it.

## References

- penpot, `comment_thread.participants` declaration — [`backend/src/app/migrations/sql/0031-add-conversation-related-tables.sql`](https://github.com/penpot/penpot/blob/2.4.3/backend/src/app/migrations/sql/0031-add-conversation-related-tables.sql)
- penpot, write-site for `participants` — [`backend/src/app/rpc/commands/comments.clj`](https://github.com/penpot/penpot/blob/2.4.3/backend/src/app/rpc/commands/comments.clj)
- lemmy, `activity.data` declaration — [`migrations/2020-03-26-192410_add_activitypub_tables/up.sql`](https://github.com/LemmyNet/lemmy/blob/0.19.5/migrations/2020-03-26-192410_add_activitypub_tables/up.sql)
- ActivityPub object semantics — [W3C ActivityPub §4](https://www.w3.org/TR/activitypub/#objects)
- listmonk, `subscribers.attribs` declaration — [`schema.sql`](https://github.com/knadh/listmonk/blob/v3.0.0/schema.sql)
- satus structural audit corpus — [`corpus/audit-2026-06-01.json`](https://satus.sh/corpus/audit-2026-06-01.json)
- satus JSONB handling, today — [`packages/cli/src/generate/schema.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/schema.ts)
