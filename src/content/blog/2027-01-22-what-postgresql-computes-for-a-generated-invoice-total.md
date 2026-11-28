---
slug: what-postgresql-computes-for-a-generated-invoice-total
title: "What PostgreSQL computes for a generated invoice total"
description: "Insert and update an invoice line with a stored generated total, then compare the database result with what the published satus simulator reports."
date: 2027-01-22
publishAt: 2027-01-22T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

A fixture for an invoice line can disagree with itself before it reaches a database. Here the total belongs to a stored generated column. PostgreSQL can compute the amount from quantity and unit price on every write. That gives the integration test a concrete expectation to check even when its seed generator reports a successful simulation.

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

## Exercise the database-owned value

The insert supplies two integers. Returning the whole row exposes the identity and generated value assigned by PostgreSQL. The next statement changes only the quantity and returns the row again. Three units at 175 cents become 525 cents. Four units become 700. These values came from the two SQL writes, separate from the earlier CLI simulation.

```sql
CREATE TABLE lines (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, quantity integer NOT NULL, unit_cents integer NOT NULL, total_cents integer GENERATED ALWAYS AS (quantity * unit_cents) STORED);
```

```text
CREATE TABLE
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
  tables:   lines

  lines                             3 rows  ~$0.0003

  estimated cost: $0.0003

  simulating + validating...
  lines . (dry-run)

  ✓ no validation findings across 1 tables
```

```sql
INSERT INTO lines (quantity,unit_cents) VALUES(3,175) RETURNING *;
```

```text
 id | quantity | unit_cents | total_cents 
----+----------+------------+-------------
  1 |        3 |        175 |         525
(1 row)

INSERT 0 1
```

## Keep an intentional failure in the fixture

The last insert includes an explicit total. Its arithmetic is correct, yet the database refuses the write because the column is generated. A fixture builder that emits every property of a previously selected row would make this mistake even if all its numbers agreed. Build the insert from writable inputs, then read back the generated fields for assertions. A successful simulation is one part of the check; the rejected insert identifies the precise database rule that the fixture must respect.

```sql
UPDATE lines SET quantity=4 RETURNING *;
```

```text
 id | quantity | unit_cents | total_cents 
----+----------+------------+-------------
  1 |        4 |        175 |         700
(1 row)

UPDATE 1
```

```sql
INSERT INTO lines (quantity,unit_cents,total_cents) VALUES(1,100,100);
```

```text
ERROR:  cannot insert a non-DEFAULT value into column "total_cents"
DETAIL:  Column "total_cents" is a generated column.
```

Process exit status: 1.

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/ddl-generated-columns.html) and [related satus log entry](/blog/generated-columns-are-load-bearing-now).
