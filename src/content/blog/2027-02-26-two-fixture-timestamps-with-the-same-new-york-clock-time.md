---
slug: two-fixture-timestamps-with-the-same-new-york-clock-time
title: "Two fixture timestamps with the same New York clock time"
description: "Insert two instants from the November clock change, render them in New York and UTC, and count what remains distinct after each conversion in PostgreSQL."
date: 2027-02-26
publishAt: 2027-02-26T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

A test that asserts the visible hour of an appointment can pass for two different appointments. New York’s repeated hour gives a compact fixture for checking what the assertion actually identifies. The input includes an explicit offset on each value. PostgreSQL therefore receives two specific instants even though both input strings say 01:30.

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

## Project one stored value into two clocks

The select renders every value in New York and UTC. The New York column repeats while the UTC column advances by an hour. A later select measures the difference directly with two distinct counts. Using an explicit zone in the expression also makes the output independent of how a workstation usually displays timestamps.

```sql
CREATE TABLE slots(id int PRIMARY KEY, visit_at timestamptz NOT NULL);
```

```text
CREATE TABLE
```

```sql
INSERT INTO slots VALUES(1,'2027-11-07 01:30:00-04'),(2,'2027-11-07 01:30:00-05');
```

```text
INSERT 0 2
```

```sql
SELECT id,visit_at AT TIME ZONE 'America/New_York' AS local_time, visit_at AT TIME ZONE 'UTC' AS utc_time FROM slots ORDER BY id;
```

```text
 id |     local_time      |      utc_time       
----+---------------------+---------------------
  1 | 2027-11-07 01:30:00 | 2027-11-07 05:30:00
  2 | 2027-11-07 01:30:00 | 2027-11-07 06:30:00
(2 rows)
```

## Choose the assertion that matches the job

If the application must preserve both appointments, compare the stored instants or another persistent identifier. If it must display a wall clock in a particular zone, assert that separately. The dry run can report a clean plan for a timestamp column without creating either of these particular instants. Put the pair in a deterministic SQL fixture when repeated-hour behavior is the subject of a regression test. These are deliberately constructed cases, with no production appointments or customer reports involved.

```sql
SELECT count(DISTINCT visit_at) AS instants, count(DISTINCT (visit_at AT TIME ZONE 'America/New_York')) AS wall_times FROM slots;
```

```text
 instants | wall_times 
----------+------------
        2 |          1
(1 row)
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
  tables:   slots

  slots                             3 rows  ~$0.0002

  estimated cost: $0.0002

  simulating + validating...
  slots . (dry-run)

  ✓ no validation findings across 1 tables
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/functions-datetime.html) and [related satus log entry](/blog/what-satus-0-3-11-checks-before-a-write).
