---
slug: what-satus-0-3-13-fills-in-for-bool-uuid-date-and-jsonb
title: What satus 0.3.13 fills in for bool, uuid, date, and jsonb
seoTitle: What 0.3.13 fills in for bool, uuid, and jsonb
description: satus 0.3.13 plans bool, uuid, date, timestamptz, numeric, jsonb, and text as those types. The dry run reports no findings. Postgres accepts the row-0 values.
date: 2026-12-11
publishAt: 2026-12-11T09:00:00-05:00
author: satus.sh
tags: [postgres, schema, seeding, types]
draft: false
---

`@passkeybridge/satus@0.3.13` maps `bool`, `uuid`, `date`, `timestamptz`, `numeric`, `jsonb`, and `text` onto JSON types in [`schema.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/schema.ts). A dry run of a table with those columns reports no findings and exits 0. The dry run does not print the simulated row. [`simulate.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/simulate.ts) specifies the index-0 value for each of those types. Postgres accepts that row.

Every transcript below ran on 2026-11-22 against PostgreSQL 17.12 (`PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit`), `psql` (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), Node v24.21.0, and `@passkeybridge/satus@0.3.13`. `npm view @passkeybridge/satus version` printed `0.3.13`. No provider key was set. `DATABASE_URL` is `postgresql://postgres:postgres@127.0.0.1:5433/typeswitch_dev`.

```sql
select version();
```

```
 PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)
```

```
$ npm view @passkeybridge/satus version
0.3.13
$ satus --version
0.3.13
```

## The schema

```sql
create table samples (
  id       integer generated always as identity primary key,
  active   boolean not null,
  code     uuid not null,
  start_on date not null,
  seen_at  timestamptz not null,
  score    numeric not null,
  payload  jsonb not null,
  label    text not null
);
```

```
CREATE TABLE
```

`id` is `GENERATED ALWAYS AS IDENTITY`. `information_schema.columns` reports `is_identity` YES and `column_default` null for that column. The other seven columns have no default. Identity columns are omitted from the insert. That has been the case since [v0.3.7](/blog/v0-3-7-release-notes).

```sql
select column_name, udt_name, is_nullable, is_identity, column_default is not null as has_default
from information_schema.columns
where table_schema = 'public' and table_name = 'samples'
order by ordinal_position;
```

```
 column_name |  udt_name   | is_nullable | is_identity | has_default 
-------------+-------------+-------------+-------------+-------------
 id          | int4        | NO          | YES         | f
 active      | bool        | NO          | NO          | f
 code        | uuid        | NO          | NO          | f
 start_on    | date        | NO          | NO          | f
 seen_at     | timestamptz | NO          | NO          | f
 score       | numeric     | NO          | NO          | f
 payload     | jsonb       | NO          | NO          | f
 label       | text        | NO          | NO          | f
(8 rows)
```

## The dry run

Stderr was empty. The exit code is 0.

```
$ satus generate --dry-run --rows 25 --profile saas

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-6-luna
  rows:     25 per table
  tables:   samples

  samples                          25 rows  ~$0.0056

  estimated cost: $0.0056

  simulating + validating...
  samples . (dry-run)

  ✓ no validation findings across 1 tables
```

## The index-0 values

`simulate.ts` builds index 0 as follows. `active` is boolean, and `i % 2 === 0` is true. `code` is `deterministicUuid(0)`, which is `00000000-0000-4000-8000-000000000001`. `start_on` is the date form of `shiftedDate(0)`, `2026-01-01`. `seen_at` is `shiftedDate(0)`, `2026-01-01T00:00:00.000Z`. `score` is numeric. With no minimum, the base is 0, so index 0 returns `Number((0 + 0 + 0.5).toFixed(2))`, which is 0.5. `payload` is an object, `{}`. `label` is the string fallback `label_1`.

The session time zone for the insert is UTC.

```sql
set timezone to 'UTC';
insert into samples (active, code, start_on, seen_at, score, payload, label)
values (
  true,
  '00000000-0000-4000-8000-000000000001',
  date '2026-01-01',
  timestamptz '2026-01-01 00:00:00+00',
  0.50,
  '{}',
  'label_1'
);
select id, active, code, start_on, seen_at, score, payload, label from samples;
```

```
SET
INSERT 0 1
 id | active |                 code                 |  start_on  |        seen_at         | score | payload |  label  
----+--------+--------------------------------------+------------+------------------------+-------+---------+---------
  1 | t      | 00000000-0000-4000-8000-000000000001 | 2026-01-01 | 2026-01-01 00:00:00+00 |  0.50 | {}      | label_1
(1 row)
```

`code_1` is not a uuid. The same insert with that string in `code` fails. The dry run did not report a `uuid_format` finding.

```sql
set timezone to 'UTC';
insert into samples (active, code, start_on, seen_at, score, payload, label)
values (
  true,
  'code_1',
  date '2026-01-01',
  timestamptz '2026-01-01 00:00:00+00',
  0.50,
  '{}',
  'label_1'
);
```

```
SET
ERROR:  invalid input syntax for type uuid: "code_1"
LINE 4:   'code_1',
          ^
```

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
