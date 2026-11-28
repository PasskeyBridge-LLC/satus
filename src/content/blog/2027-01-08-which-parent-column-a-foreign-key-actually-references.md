---
slug: which-parent-column-a-foreign-key-actually-references
title: "Which parent column a foreign key actually references"
description: "Resolve a foreign key against a unique text column and compare its catalog attribute number with the parent identity key in a three-row satus dry run."
date: 2027-01-08
publishAt: 2027-01-08T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

The parent key in this example is an integer. The child stores text. A generator that takes the first primary-key value returned by the parent insert would have the right parent table and the wrong value. The constraint records which attribute to read. The August 0.3.7 release corrected parent resolution for references of this kind; the test below makes the two possible values visibly different.

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

## Read the two attribute numbers

The constraint query gives two arrays. In this single-column example, the first identifies the referencing column in the child and the second identifies the referenced column in the parent. Both happen to be 2. The second query resolves attribute 2 in the parent to code. Attribute 1 is the identity column. Those numbers are local to a relation, so resolving either array against the wrong relation changes the meaning of the result.

```sql
CREATE TABLE parent (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, code text UNIQUE); CREATE TABLE child (id int PRIMARY KEY, parent_code text REFERENCES parent(code));
```

```text
CREATE TABLE
CREATE TABLE
```

```sql
SELECT conrelid::regclass AS child, confrelid::regclass AS parent, conkey, confkey FROM pg_constraint WHERE conrelid='child'::regclass AND contype='f';
```

```text
 child | parent | conkey | confkey 
-------+--------+--------+---------
 child | parent | {2}    | {2}
(1 row)
```

## Check the planner separately

The CLI orders parent before child. That order is necessary for building the pool of parent values. It would also be the order for a reference to the integer primary key, so table order alone cannot distinguish the two cases. The catalog result is the piece of evidence that tells a fixture author which parent value belongs in the child. The simulation demonstrates planning and validation; it does not show an inserted child row.

```sql
SELECT attnum, attname, attidentity FROM pg_attribute WHERE attrelid='parent'::regclass AND attnum>0 ORDER BY attnum;
```

```text
 attnum | attname | attidentity 
--------+---------+-------------
      1 | id      | a
      2 | code    | 
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
  tables:   parent -> child

  parent                            3 rows  ~$0.0002
  child                             3 rows  ~$0.0002

  estimated cost: $0.0003

  simulating + validating...
  parent . (dry-run)
  child . (dry-run)

  ✓ no validation findings across 2 tables
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) and [related satus log entry](/blog/v0-3-7-release-notes).
