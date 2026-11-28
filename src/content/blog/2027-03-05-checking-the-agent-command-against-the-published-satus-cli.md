---
slug: checking-the-agent-command-against-the-published-satus-cli
title: "Checking the agent command against the published satus CLI"
description: "Inspect the command list for the pinned release, capture the result of invoking agent, and compare it with a supported dry run against a disposable table."
date: 2027-03-05
publishAt: 2027-03-05T09:00:00-05:00
author: satus.sh
tags: [postgres, cli, seeding]
draft: false
---

The roadmap and the installed command list answer different questions. For the version tested here, the quickest check is to record the help text, invoke the proposed command and preserve its exit status. The March date on this post is an editorial slot. The observation below is attached to a specific release and test date.

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

## Compare the two invocations

The top-level help lists the available operations. Invoking agent produces an unknown-command error and usage text. That outcome occurs before any database generation takes place. A script that assumes agent support because a roadmap mentions it would stop at command parsing on this installation.

```sh
satus --help
```

```text
Usage: satus [options] [command]

Generate realistic seed data for Postgres. Respects FKs, constraints, and your
schema.

Options:
  -v, --version       print CLI version
  -h, --help          display help for command

Commands:
  init [options]      Scaffold satus.config.json in the current directory
  generate [options]  Generate seed data for the configured database
  activate <key>      Activate a Pro or Team license key
  whoami              Show the currently activated license (from local cache)
  help [command]      display help for command
```

```sh
satus agent
```

```text
error: unknown command 'agent'

Usage: satus [options] [command]

Generate realistic seed data for Postgres. Respects FKs, constraints, and your
schema.

Options:
  -v, --version       print CLI version
  -h, --help          display help for command

Commands:
  init [options]      Scaffold satus.config.json in the current directory
  generate [options]  Generate seed data for the configured database
  activate <key>      Activate a Pro or Team license key
  whoami              Show the currently activated license (from local cache)
  help [command]      display help for command
```

Process exit status: 1.

```sql
CREATE TABLE sample(id int PRIMARY KEY, label text NOT NULL);
```

```text
CREATE TABLE
```

## Verify a supported route with the same executable

The second half creates one table and asks generate for a dry run. The planner recognizes the table and reports a simulation. The final count checks that the table is still empty. It is a useful control for the first observation: the package starts, the database is reachable and a documented operation runs. Nothing in this experiment measures demand for an agent, establishes a shipping date, or gives a reason for a roadmap decision. Those questions require separate release evidence.

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
  tables:   sample

  sample                            3 rows  ~$0.0002

  estimated cost: $0.0002

  simulating + validating...
  sample . (dry-run)

  ✓ no validation findings across 1 tables
```

```sql
SELECT count(*) FROM sample;
```

```text
 count 
-------
     0
(1 row)
```

References: [PostgreSQL 17 documentation](https://www.postgresql.org/docs/17/app-psql.html) and [related satus log entry](/blog/agent-mode-postponed).
