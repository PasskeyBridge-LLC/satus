---
slug: testing-ci-fixture-isolation-with-two-postgresql-schemas
title: "Testing CI fixture isolation with two PostgreSQL schemas"
description: "Run the same table name in two local schemas, target one with a satus dry run and use a rolled-back insert to check exactly which state a test can see."
date: 2027-01-15
publishAt: 2027-01-15T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

A CI job that finishes with an empty table can still have inspected the wrong namespace. Give the two candidate tables different starting contents and the mistake becomes observable. This run uses two schemas inside a single disposable database. It measures namespace selection and rollback. It contains no elapsed-time comparison of hosted branches or containers.

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

## Give the control a row

Both namespaces contain a jobs table with the same definition. Only the first has a row. The dry run explicitly names the second schema. Its plan contains one table. The first count after the plan checks both qualified names in the same query. Looking only at the unqualified name would introduce the session search path as another variable.

```sql
CREATE SCHEMA branch_a; CREATE SCHEMA branch_b; CREATE TABLE branch_a.jobs(id int primary key); CREATE TABLE branch_b.jobs(id int primary key); INSERT INTO branch_a.jobs VALUES(1);
```

```text
CREATE SCHEMA
CREATE SCHEMA
CREATE TABLE
CREATE TABLE
INSERT 0 1
```

```sh
satus generate --dry-run --rows 3 --schema branch_b
```

```text
satus generate
  schema:   branch_b
  profile:  saas
  provider: openai
  model:    gpt-6-luna
  rows:     3 per table
  tables:   jobs

  jobs                              3 rows  ~$0.0001

  estimated cost: $0.0001

  simulating + validating...
  jobs . (dry-run)

  ✓ no validation findings across 1 tables
```

```sql
SELECT (SELECT count(*) FROM branch_a.jobs) AS a, (SELECT count(*) FROM branch_b.jobs) AS b;
```

```text
 a | b 
---+---
 1 | 0
(1 row)
```

## Check cleanup at the layer you intend to share

The explicit insert into the second namespace takes place in a transaction that is rolled back. The final query opens a fresh session and checks the table by its qualified name. In a CI design that shares a service, use separate namespaces or databases for workers that need independent committed state. For a job that provisions a whole database, move the same before-and-after assertions into that job. Record provisioning time on the actual runner before using timing as the reason to choose one design.

```sql
BEGIN; INSERT INTO branch_b.jobs VALUES(2); ROLLBACK;
```

```text
BEGIN
INSERT 0 1
ROLLBACK
```

```sql
SELECT count(*) FROM branch_b.jobs;
```

```text
 count 
-------
     0
(1 row)
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/ddl-schemas.html) and [related satus log entry](/blog/pg-dump-snapshots-as-test-fixtures).
