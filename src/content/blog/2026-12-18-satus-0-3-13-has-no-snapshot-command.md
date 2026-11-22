---
slug: satus-0-3-13-has-no-snapshot-command
title: satus 0.3.13 has no snapshot command and no --seed flag
description: satus 0.3.13 rejects the command snapshot and the flag --seed. Two dry runs of one schema print the same plan. The roadmap file still names the command.
date: 2026-12-18
publishAt: 2026-12-18T09:00:00-05:00
author: satus.sh
tags: [cli, seeding, postgres]
draft: false
---

`satus snapshot` is not a command in `@passkeybridge/satus@0.3.13`. `satus generate --seed` is not a flag. Two `satus generate --dry-run` runs against the same schema wrote the same stdout. The dry-run path uses the simulator in [`simulate.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/simulate.ts). A generate without `--dry-run` calls the selected provider. This post did not make that call.

Phase 2 item 3 in [`docs/ROADMAP.md` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/docs/ROADMAP.md) is named `satus snapshot`. The command list printed below does not include it. The [9 October post](/blog/pg-dump-snapshots-as-test-fixtures) is the `pg_dump` fixture workflow. This post does not rerun that workflow.

Every transcript below ran on 2026-11-22 against PostgreSQL 17.12 (`PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit`), `psql` (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), Node v24.21.0, and `@passkeybridge/satus@0.3.13`. `npm view @passkeybridge/satus version` printed `0.3.13`. No provider key was set. `DATABASE_URL` for the dry runs is `postgresql://postgres:postgres@127.0.0.1:5433/snap_dev`.

```sql
select version();
```

```
 PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)
```

```
$ satus --version
0.3.13
```

## The command

Stdout was empty. The exit code is 1.

```
$ satus snapshot

error: unknown command 'snapshot'

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

`satus snapshot --help` wrote the usage text above to stdout, with no `error:` line. Stderr was empty. The exit code is 0.

`satus help snapshot` wrote that same usage text to stderr. Stdout was empty. The exit code is 1. It did not print `unknown command`.

## The flag

Stdout was empty. The exit code is 1. `satus generate --seed 1` printed the same stderr and exited 1.

```
$ satus generate --seed

error: unknown option '--seed'

Usage: satus generate [options]

Generate seed data for the configured database

Options:
  --profile <name>  reference profile (saas | ecommerce | b2b)
  --rows <n>        rows to generate per table (default: "50")
  --max-cost <usd>  abort if estimated LLM spend exceeds this (default: "1.00")
  --batch-size <n>  rows per LLM call (default: "25")
  --dsn <url>       Postgres connection string (overrides config + env)
  --schema <name>   Postgres schema to seed (overrides config)
  --provider <id>   LLM provider (openai | anthropic | xai); auto-detected from
                    env when omitted
  --model <id>      model id (overrides config; falls back to the provider
                    default)
  --truncate        truncate target tables before inserting
  --force           bypass the 10,000-row safety guard (exit 11 when it trips)
  --dry-run         simulate LLM output and run relational validation without
                    writing rows or spending credits
  -v, --verbose     print per-batch token + cost breakdown
  --json            emit a single machine-readable JSON object on stdout (human
                    output goes to stderr)
  -h, --help        display help for command
```

## Two dry runs

```sql
create table customers (
  id    integer generated always as identity primary key,
  email text not null unique
);

create table orders (
  id          integer generated always as identity primary key,
  customer_id integer not null references customers(id),
  total_cents integer not null
);
```

```
CREATE TABLE
CREATE TABLE
```

The working directory had no `satus.config.json`. Stderr was empty. The exit code is 0.

```
$ satus generate --dry-run --rows 25 --profile saas

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-6-luna
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0014
  orders                           25 rows  ~$0.0021

  estimated cost: $0.0035

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

The same command, run again in the same directory, wrote the same stdout and the same empty stderr, and exited 0. `diff -u` of the two stdout files exited 0 and wrote no output.

A config file with an unknown key did not change that plan and did not error. The file was:

```json
{
  "provider": "openai",
  "seed": 1
}
```

`satus generate --dry-run --rows 25` with that file, and `DATABASE_URL` still set to `snap_dev`, exited 0. Stderr was empty. Stdout matched the dry run above.

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
