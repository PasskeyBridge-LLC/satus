---
slug: count-self-references-separately-in-a-schema-audit
title: "Count self-references separately in a schema audit"
description: "Trace two foreign keys in a small catalog fixture and see why the number of references and the number of self-referencing edges answer different questions."
date: 2027-02-19
publishAt: 2027-02-19T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

A category can refer to its parent category, while a product can refer to a category. Both links appear as foreign keys. Only one returns to its own relation. This miniature audit keeps both rows visible so a reader can check exactly what a count includes before comparing it to a larger schema corpus.

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

## Identify an edge by both ends

The catalog query selects the child relation, the parent relation and a Boolean equality test on their identifiers. The displayed names make the result easy to inspect, while the equality test avoids guessing from a column name. The second relation has a reference and no self-reference. Counting tables containing a foreign key would lose that distinction.

```sql
CREATE TABLE category(id int PRIMARY KEY, parent_id int REFERENCES category(id)); CREATE TABLE product(id int PRIMARY KEY, category_id int REFERENCES category(id));
```

```text
CREATE TABLE
CREATE TABLE
```

```sql
SELECT conrelid::regclass AS child, confrelid::regclass AS parent, conrelid=confrelid AS self_edge FROM pg_constraint WHERE contype='f' ORDER BY 1;
```

```text
  child   |  parent  | self_edge 
----------+----------+-----------
 category | category | t
 product  | category | f
(2 rows)
```

## Read the planner output alongside the audit

The dry run lists category before product and finishes with no findings. The last query counts one self-edge. A nullable parent reference permits a root category, which makes this fixture different from two required references depending on one another. An audit that reports a self-edge has described structure. Establishing which cyclic data actually occur would take rows and a different query. Keep those two questions separate when deciding what an audit statistic means.

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
  tables:   category -> product

  category                          3 rows  ~$0.0002
  product                           3 rows  ~$0.0002

  estimated cost: $0.0003

  simulating + validating...
  category . (dry-run)
  product . (dry-run)

  ✓ no validation findings across 2 tables
```

```sql
SELECT count(*) AS self_edges FROM pg_constraint WHERE contype='f' AND conrelid=confrelid;
```

```text
 self_edges 
------------
          1
(1 row)
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) and [related satus log entry](/blog/the-cycle-breaking-heuristic-we-never-shipped).
