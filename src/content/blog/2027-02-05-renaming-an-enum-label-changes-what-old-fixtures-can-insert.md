---
slug: renaming-an-enum-label-changes-what-old-fixtures-can-insert
title: "Renaming an enum label changes what old fixtures can insert"
description: "Rename a PostgreSQL enum label, inspect an existing row and its column default, then try the old spelling in an insert against the migrated table."
date: 2027-02-05
publishAt: 2027-02-05T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

Adding an enum value leaves a familiar fixture spelling available. Renaming it is a different test. This example keeps one row, one database default and one literal embedded in an insert. All three started with the same spelling. After the migration they follow different paths.

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

## Read the stored row and exercise the default

The first row predates the rename. The second is inserted afterward using the same default expression. Both rows display waiting. A test that only creates rows using defaults can therefore pass after the migration while an application fixture still contains a broken literal.

```sql
CREATE TYPE stage AS ENUM ('queued','done'); CREATE TABLE jobs(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, state stage DEFAULT 'queued'); INSERT INTO jobs DEFAULT VALUES;
```

```text
CREATE TYPE
CREATE TABLE
INSERT 0 1
```

```sql
ALTER TYPE stage RENAME VALUE 'queued' TO 'waiting';
```

```text
ALTER TYPE
```

```sql
INSERT INTO jobs DEFAULT VALUES RETURNING *;
```

```text
 id |  state  
----+---------
  2 | waiting
(1 row)

INSERT 0 1
```

```sql
SELECT id,state FROM jobs ORDER BY id;
```

```text
 id |  state  
----+---------
  1 | waiting
  2 | waiting
(2 rows)
```

## Try the old input at the boundary

The explicit insert using queued fails. The subsequent CLI simulation completes, and the SQL error remains independently reproducible. Keep one test exercising the database default and another exercising the string the fixture sends. If an application stores the spelling in JSON or a text file, inspect that input separately. The change to a PostgreSQL enum label cannot edit a fixture file on disk. This case extends the earlier label-addition tests with a migration that invalidates an input that used to be accepted.

```sql
INSERT INTO jobs(state) VALUES('queued');
```

```text
ERROR:  invalid input value for enum stage: "queued"
LINE 1: INSERT INTO jobs(state) VALUES('queued');
                                       ^
```

Process exit status: 1.

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
  tables:   jobs

  jobs                              3 rows  ~$0.0002

  estimated cost: $0.0002

  simulating + validating...
  jobs . (dry-run)

  ✓ no validation findings across 1 tables
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/datatype-enum.html) and [related satus log entry](/blog/what-satus-0-3-11-does-with-an-enum-column).
