---
slug: checking-a-deferred-foreign-key-before-commit
title: "Checking a deferred foreign key before commit"
description: "Insert a child before its parent in one transaction, force a deferred check in another, and read the rows left behind after the second transaction fails."
date: 2027-03-19
publishAt: 2027-03-19T09:00:00-04:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

The foreign key in this fixture starts in immediate mode. Its definition also allows a transaction to defer the check. That changes when PostgreSQL must find a matching parent. It does not remove the obligation to supply one. Two transactions below exercise the successful and unsuccessful paths with different parent identifiers.

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

## Resolve the reference within the transaction

The first transaction requests deferred checks, inserts a child, then inserts the folder it references. The commit completes. The second transaction inserts a child pointing to another missing folder and switches checks back to immediate before adding that folder. PostgreSQL checks the outstanding reference at that point and returns an error.

```sql
CREATE TABLE folders(id int PRIMARY KEY); CREATE TABLE files(id int PRIMARY KEY, folder_id int NOT NULL REFERENCES folders(id) DEFERRABLE INITIALLY IMMEDIATE);
```

```text
CREATE TABLE
CREATE TABLE
```

```sql
BEGIN; SET CONSTRAINTS ALL DEFERRED; INSERT INTO files VALUES(1,9); INSERT INTO folders VALUES(9); COMMIT;
```

```text
BEGIN
SET CONSTRAINTS
INSERT 0 1
INSERT 0 1
COMMIT
```

```sql
BEGIN; SET CONSTRAINTS ALL DEFERRED; INSERT INTO files VALUES(2,10); SET CONSTRAINTS ALL IMMEDIATE;
```

```text
BEGIN
SET CONSTRAINTS
INSERT 0 1
ERROR:  insert or update on table "files" violates foreign key constraint "files_folder_id_fkey"
DETAIL:  Key (folder_id)=(10) is not present in table "folders".
```

Process exit status: 1.

## Inspect the state from a fresh session

Each SQL block below is a separate psql invocation. The failed transaction cannot be left open by the client for the final select. Only the child from the committed transaction is visible. The dry run independently plans folders before files. A plan following the usual parent-first order will not exercise deferred behavior, so keep the transaction-level regression even if the planner check stays green. If your migration changes the constraint to nondeferrable, this child-first fixture should expose the change.

```sql
SELECT * FROM files ORDER BY id;
```

```text
 id | folder_id 
----+-----------
  1 |         9
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
  tables:   folders -> files

  folders                           3 rows  ~$0.0001
  files                             3 rows  ~$0.0002

  estimated cost: $0.0003

  simulating + validating...
  folders . (dry-run)
  files . (dry-run)

  ✓ no validation findings across 2 tables
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/sql-set-constraints.html) and [related satus log entry](/blog/the-cycle-breaking-heuristic-we-never-shipped).
