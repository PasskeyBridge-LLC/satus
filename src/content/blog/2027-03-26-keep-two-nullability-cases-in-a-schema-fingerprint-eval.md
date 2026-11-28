---
slug: keep-two-nullability-cases-in-a-schema-fingerprint-eval
title: "Keep two nullability cases in a schema fingerprint eval"
description: "Compare two catalog snapshots that differ in one nullability flag, then run the CLI on both and inspect which distinctions fingerprint normalization retains."
date: 2027-03-26
publishAt: 2027-03-26T09:00:00-04:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

The two versions of this fixture contain the same named table, integer columns and primary key. One version lets points be null and the other requires a value. An evaluation set for synthetic data needs both cases if it is meant to catch missing required fields. A structural fingerprint alone is too coarse a grouping key for that particular test.

The transcripts were recorded on November 28, 2026, using the npm distribution of @passkeybridge/satus 0.3.13 and a disposable PostgreSQL 17.10 instance. Each SQL block ran in its own psql session. The CLI used a local connection and dry-run mode for generation.

```sh
satus --version
```

```text
0.3.13
```

```sql
SHOW server_version;
```

```text
  server_version  
------------------
 17.10 (Homebrew)
(1 row)
```

## Inspect the bit that changes

The first catalog result shows false for the second column’s attnotnull flag. After the alteration it shows true. Both dry runs plan one table and report no validation findings. The fixture records the schema change directly, so a reviewer can confirm the difference even when those summary lines look the same.

```sql
CREATE TABLE fixtures(id int PRIMARY KEY, points int);
```

```text
CREATE TABLE
```

```sql
SELECT attnum,format_type(atttypid,atttypmod),attnotnull FROM pg_attribute WHERE attrelid='fixtures'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum;
```

```text
 attnum | format_type | attnotnull 
--------+-------------+------------
      1 | integer     | t
      2 | integer     | f
(2 rows)
```

```sh
satus generate --dry-run --rows 3
```

```text
satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-6-luna
  rows:     3 per table
  tables:   fixtures

  fixtures                          3 rows  ~$0.0002

  estimated cost: $0.0002

  simulating + validating...
  fixtures . (dry-run)

  ✓ no validation findings across 1 tables
```

```sql
ALTER TABLE fixtures ALTER COLUMN points SET NOT NULL;
```

```text
ALTER TABLE
```

## Use the fingerprint at its documented resolution

The released normalizer records column type names, primary-key arity, a count of single-column uniqueness entries and foreign-key edges. Nullability is absent from that representation. For this pair the normalized inputs therefore agree. Preserve the nullability expectation as separate fixture metadata when grouping cases. This exercise uses two local schema states and zero collected telemetry records. It makes no estimate of how frequently this pattern occurs in other databases.

```sql
SELECT attnum,format_type(atttypid,atttypmod),attnotnull FROM pg_attribute WHERE attrelid='fixtures'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum;
```

```text
 attnum | format_type | attnotnull 
--------+-------------+------------
      1 | integer     | t
      2 | integer     | t
(2 rows)
```

```sh
satus generate --dry-run --rows 3
```

```text
satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-6-luna
  rows:     3 per table
  tables:   fixtures

  fixtures                          3 rows  ~$0.0002

  estimated cost: $0.0002

  simulating + validating...
  fixtures . (dry-run)

  ✓ no validation findings across 1 tables
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/catalog-pg-attribute.html) and [related satus log entry](/blog/v0-3-3-release-notes).

The implementation is in [fingerprint.ts at v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/fingerprint.ts).
