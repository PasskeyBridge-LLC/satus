---
slug: testing-a-seed-date-at-a-range-partition-boundary
title: "Testing a seed date at a range partition boundary"
description: "Insert records on either side of a monthly partition boundary, inspect their physical destinations and compare routing with the table in the satus plan."
date: 2027-03-12
publishAt: 2027-03-12T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

A generator can choose the correct parent table and still supply a value that no partition accepts. This run makes January 31 and February 1 adjacent test dates. Only the January partition exists for the first attempt. The error identifies the missing range precisely enough to distinguish routing from a malformed date.

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

## Change the available destination

The lower bound of the January range includes January 1. Its upper bound excludes February 1. After the initial failure the fixture adds the February range and repeats the same insert. The row then succeeds. No change to the submitted date or label was necessary.

```sql
CREATE TABLE events (day date NOT NULL, label text) PARTITION BY RANGE(day); CREATE TABLE events_jan PARTITION OF events FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
```

```text
CREATE TABLE
CREATE TABLE
```

```sql
INSERT INTO events VALUES ('2027-01-31','closing');
```

```text
INSERT 0 1
```

```sql
INSERT INTO events VALUES ('2027-02-01','opening');
```

```text
ERROR:  no partition of relation "events" found for row
DETAIL:  Partition key of the failing row contains (day) = (2027-02-01).
```

Process exit status: 1.

```sql
CREATE TABLE events_feb PARTITION OF events FOR VALUES FROM ('2027-02-01') TO ('2027-03-01'); INSERT INTO events VALUES ('2027-02-01','opening');
```

```text
CREATE TABLE
INSERT 0 1
```

## Inspect what actually received each row

The tableoid column exposes the underlying relation for each row selected through the parent. Casting the identifier to regclass gives names a reader can compare directly with the partition definitions. The dry run lists the parent as the planned table. It does not demonstrate coverage for all future input dates. For a fixture that crosses several boundaries, keep one accepted value on each side and a separate case beyond the last range. If the schema has a default partition, add an assertion for which rows should land there.

```sql
SELECT tableoid::regclass AS destination,day,label FROM events ORDER BY day;
```

```text
 destination |    day     |  label  
-------------+------------+---------
 events_jan  | 2027-01-31 | closing
 events_feb  | 2027-02-01 | opening
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
  tables:   events

  events                            3 rows  ~$0.0002

  estimated cost: $0.0002

  simulating + validating...
  events . (dry-run)

  ✓ no validation findings across 1 tables
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/ddl-partitioning.html) and [related satus log entry](/blog/v0-2-0-deferred-constraints-faster-planning-smaller-binary).
