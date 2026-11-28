---
slug: checking-invoice-arithmetic-after-a-seed-dry-run
title: "Checking invoice arithmetic after a seed dry run"
description: "A line can reference a valid invoice and still carry the wrong total. Run the discrepancy query, add a check, and validate the repaired fixture."
date: 2027-02-12
publishAt: 2027-02-12T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

The fixture contains a valid parent reference, a quantity of three, a unit price of 200 cents and a stored total of 400 cents. Every value fits its column. The reference has a matching invoice. Multiplication is where the row fails. Keeping these numbers small makes the failure visible without a second program to calculate an expected answer.

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

## Inspect an existing row

The discrepancy query returns the stored amount beside the computed one. The published CLI then simulates new rows for the two tables. Its clean report does not certify the arithmetic of the row already in the database. That distinction matters if a test harness treats the report as an audit of a restored fixture.

```sql
CREATE TABLE invoices (id int PRIMARY KEY); CREATE TABLE lines(id int PRIMARY KEY, invoice_id int REFERENCES invoices(id), quantity int, unit_cents int, total_cents int); INSERT INTO invoices VALUES(1); INSERT INTO lines VALUES(1,1,3,200,400);
```

```text
CREATE TABLE
CREATE TABLE
INSERT 0 1
INSERT 0 1
```

```sql
SELECT id, total_cents, quantity*unit_cents AS expected FROM lines WHERE total_cents IS DISTINCT FROM quantity*unit_cents;
```

```text
 id | total_cents | expected 
----+-------------+----------
  1 |         400 |      600
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
  tables:   invoices -> lines

  invoices                          3 rows  ~$0.0001
  lines                             3 rows  ~$0.0004

  estimated cost: $0.0005

  simulating + validating...
  invoices . (dry-run)
  lines . (dry-run)

  ✓ no validation findings across 2 tables
```

```sql
ALTER TABLE lines ADD CONSTRAINT consistent_total CHECK(total_cents=quantity*unit_cents) NOT VALID;
```

```text
ALTER TABLE
```

## Validate the constraint on existing data

Adding a check with NOT VALID and validating it are separate actions. The validation statement fails on the existing row. After the explicit repair the same validation succeeds. For a schema where all three values are required, declare that requirement separately too: a check expression involving SQL null can have an unknown result. Decide which invariant belongs in column definitions and which belongs in the application. Make the assertion in the layer that owns the rule.

```sql
ALTER TABLE lines VALIDATE CONSTRAINT consistent_total;
```

```text
ERROR:  check constraint "consistent_total" of relation "lines" is violated by some row
```

Process exit status: 1.

```sql
UPDATE lines SET total_cents=quantity*unit_cents; ALTER TABLE lines VALIDATE CONSTRAINT consistent_total;
```

```text
UPDATE 1
ALTER TABLE
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/ddl-constraints.html) and [related satus log entry](/blog/what-satus-0-3-11-checks-before-a-write).
