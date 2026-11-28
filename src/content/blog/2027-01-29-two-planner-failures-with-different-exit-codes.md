---
slug: two-planner-failures-with-different-exit-codes
title: "Two planner failures with different exit codes"
description: "Compare an empty schema with a pair of required foreign keys forming a cycle, and check the process status and the final row count for each table."
date: 2027-01-29
publishAt: 2027-01-29T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

The first command in this run contains two potential problems: the schema is empty and the row argument is a word. The diagnostic is about the empty schema. That matters when a CI wrapper tries to turn any nonzero result into a suggestion about command-line syntax. The message tells us which check actually ended this invocation.

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

## Change the schema before repeating the plan

The next database contains two required references forming a cycle. There is no table whose first row could satisfy its parent by drawing from a row inserted earlier in this plan. The second invocation uses a numeric row argument and exits 10. The diagnostic names both tables and explains the nullable-edge condition the planner looks for.

```sh
satus generate --dry-run --rows banana
```

```text
No tables found in schema "public".
```

Process exit status: 1.

```sql
CREATE TABLE alpha(id integer PRIMARY KEY, beta_id integer NOT NULL); CREATE TABLE beta(id integer PRIMARY KEY, alpha_id integer NOT NULL REFERENCES alpha(id)); ALTER TABLE alpha ADD FOREIGN KEY(beta_id) REFERENCES beta(id);
```

```text
CREATE TABLE
CREATE TABLE
ALTER TABLE
```

## Retain output and status together

An empty plan and an unsortable plan require different fixture changes. Save the process status alongside the text from stderr before deciding whether to revise configuration or the schema. The final select checks both tables in one statement; neither contains a row. That verifies the state after this pair of runs. It does not establish the handling of every invalid value for the row argument. To isolate that option, start with a populated schema definition and vary only the option.

```sh
satus generate --dry-run --rows 3
```

```text
FK cycle detected with no nullable back-edge: alpha, beta
  satus v0.2 breaks cycles by NULLing a nullable back-edge column and populating
  it after every table is seeded. None of the cycle FKs are nullable, so the
  cycle cannot be broken without violating NOT NULL.
  Fix: make one of the FK columns nullable, or `exclude` one of the tables in
  satus.config.json and re-run.
```

Process exit status: 10.

```sql
SELECT (SELECT count(*) FROM alpha) AS alpha_rows,(SELECT count(*) FROM beta) AS beta_rows;
```

```text
 alpha_rows | beta_rows 
------------+-----------
          0 |         0
(1 row)
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/ddl-constraints.html) and [related satus log entry](/blog/satus-0-3-11-exit-codes).
