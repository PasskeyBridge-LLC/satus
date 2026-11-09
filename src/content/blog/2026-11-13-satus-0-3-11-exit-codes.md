---
slug: satus-0-3-11-exit-codes
title: The exit codes satus 0.3.12 returns, and what each one means in CI
seoTitle: satus 0.3.12 exit codes and what each one means in CI
description: satus 0.3.12 exits 0, 1, 2, 10, or 11. Each code was reproduced on PostgreSQL 17.11, with the message it prints and a set -e safe CI script.
date: 2026-11-13
publishAt: 2026-11-13T09:00:00-05:00
author: satus.sh
tags: [cli, ci, postgres, seeding]
draft: false
---

`@passkeybridge/satus@0.3.12` exits with one of five codes: `0`, `1`, `2`, `10`, and `11`. They are defined in [`exit-codes.ts` at tag v0.3.12](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.12/packages/cli/src/exit-codes.ts). A pipeline branches on them, so the values stay stable. `10` and `11` mean satus declined to act. `1` means it tried, or it never got as far as a plan.

Every transcript below ran on 2026-11-06 against PostgreSQL 17.11 (`PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2)`), `psql` 17.11, Node v24.21.0, and `@passkeybridge/satus@0.3.12`, with no provider key unless a command shows one. `DATABASE_URL` for the schema sections is `postgresql://postgres:postgres@127.0.0.1:5433/exit_dev`.

| code | name | meaning |
|---|---|---|
| `0` | | success; for `--dry-run`, no validator errors |
| `1` | `E_GENERAL` | anything unclassified: configuration, connection, provider, or database error |
| `2` | `E_VALIDATION` | `--dry-run` finished and the validator reported errors |
| `10` | `E_FK_CYCLE` | a foreign-key cycle that satus cannot break; nothing written |
| `11` | `E_DB_NOT_EMPTY` | the row guard refused; nothing written |

## The schema

```sql
create table currencies (
  id   integer generated always as identity primary key,
  code text not null unique
);

create table accounts (
  id          integer generated always as identity primary key,
  currency_id integer not null references currencies(id),
  name        text not null
);
```

## Exit 1: configuration

With no `--dsn`, no `DATABASE_URL`, no `SATUS_DATABASE_URL`, and no `satus.config.json`:

```
$ satus generate --dry-run
No database connection configured.
  Pass --dsn, set $DATABASE_URL, or run `satus init`.
```

A real run, without `--dry-run`, checks the provider key before it connects:

```
$ satus generate --rows 25
OPENAI_API_KEY is not set.
  Export it before running, or pass --dry-run to plan without calling the model.
```

An unknown provider. 0.3.12 names three providers. The xAI provider commit is `ff9808a`, which is after the v0.3.11 tag.

```
$ satus generate --dry-run --rows 25 --provider gemini
Unknown --provider: gemini. Use openai | anthropic | xai.
```

All three exit `1`. So does a database that refuses the connection:

```
$ satus generate --dry-run --rows 25 --dsn postgresql://postgres@127.0.0.1:5499/ledger_dev
Failed to connect to Postgres: connect ECONNREFUSED 127.0.0.1:5499
```

The same command with `localhost` in place of `127.0.0.1`:

```
$ satus generate --dry-run --rows 25 --dsn postgresql://postgres@localhost:5499/ledger_dev
Failed to connect to Postgres: 
```

On this machine `localhost` resolves to more than one address. When each connection fails, Node v24.21.0 reports an `AggregateError` whose `message` is empty, and satus prints only the prefix. The exit code is still `1`. If the line ends at `Failed to connect to Postgres:`, retry with an IP address to see the reason.

Exit `1` also covers a provider error, a database error on insert, and a `--max-cost` abort during a real run. Transactional table changes roll back. Sequence values allocated by ordinary inserts can remain consumed. A pipeline should treat `1` as a failure that needs a person to read the log.

## Exit 0 and exit 2: the dry run as a gate

`--dry-run` plans the run, simulates rows without calling a model, and validates them against foreign keys, types, `NOT NULL`, varchar lengths, and single-column `UNIQUE` constraints. With no errors it exits `0`:

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   currencies -> accounts

  currencies                       25 rows  ~$0.0018
  accounts                         25 rows  ~$0.0027

  estimated cost: $0.0045

  simulating + validating...
  currencies . (dry-run)
  accounts . (dry-run)

  ✓ no validation findings across 2 tables
```

Change `code` to `char(3)`:

```sql
alter table currencies alter column code type char(3);
```

The simulator fills a string column with `<column>_<n>` and cuts it to the column's length, so every simulated `code` is `cod`. The validator catches the duplicates and the dry run exits `2`:

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   currencies -> accounts

  currencies                       25 rows  ~$0.0018
  accounts                         25 rows  ~$0.0027

  estimated cost: $0.0045

  simulating + validating...
  currencies . (dry-run)
  accounts . (dry-run)

  findings: 24 error / 0 warn
  error currencies.code                      unique_duplicate   x24  rows[1,2,3+]
         Duplicate value in UNIQUE column "code" within the same batch
```

Exit `2` means the dry run itself finished and found something wrong with the plan. With `--json`, stdout is one object and the exit code stays `2`:

```
$ satus generate --dry-run --rows 25 --json > result.json 2>/dev/null
$ echo EXIT:$?
EXIT:2
$ jq -c '{status, errors: .validation.error_count}' result.json
{"status":"dry_run_invalid","errors":24}
```

The `status` field is `dry_run_invalid` when the exit is `2` and `dry_run` when it is `0`.

Put `code` back to `text` before the next section:

```sql
alter table currencies alter column code type text;
```

## Exit 10: a cycle satus cannot break

satus inserts parents before children. When two tables reference each other, it needs one foreign key it can leave `NULL` on insert and fill in after both tables are seeded, inside the same transaction. Add a cycle where both columns are `NOT NULL`:

```sql
create table teams (
  id       integer generated always as identity primary key,
  owner_id integer not null
);

create table users (
  id      integer generated always as identity primary key,
  team_id integer not null references teams(id)
);

alter table teams add constraint teams_owner_fk
  foreign key (owner_id) references users(id)
  deferrable initially deferred;
```

```
$ satus generate --dry-run --rows 25
FK cycle detected with no nullable back-edge: teams, users
  satus v0.2 breaks cycles by NULLing a nullable back-edge column and populating
  it after every table is seeded. None of the cycle FKs are nullable, so the
  cycle cannot be broken without violating NOT NULL.
  Fix: make one of the FK columns nullable, or `exclude` one of the tables in
  satus.config.json and re-run.
```

The exit code is `10`. The constraint is `deferrable initially deferred`, and satus still exits `10`. A column default does not change the result:

```sql
alter table teams alter column owner_id set default 0;
```

The next dry run prints the same cycle message and exits `10`. The [troubleshooting](/docs/troubleshooting) page says the same: a column `DEFAULT` or a `DEFERRABLE INITIALLY DEFERRED` constraint does not break the cycle. Making one FK column on the cycle nullable does:

```sql
alter table teams alter column owner_id drop not null;
```

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   currencies -> teams -> accounts -> users
  cycles:   teams.owner_id -> users (deferred)

  currencies                       25 rows  ~$0.0018
  teams                            25 rows  ~$0.0018
  accounts                         25 rows  ~$0.0027
  users                            25 rows  ~$0.0018

  estimated cost: $0.0081

  simulating + validating...
  currencies . (dry-run)
  teams . (dry-run)
  accounts . (dry-run)
  users . (dry-run)

  ✓ no validation findings across 4 tables
```

The plan has a `cycles:` line naming the edge satus will fill in after the insert. Exit `10` happens during planning, before any write. A pipeline can treat it as a schema problem rather than a flaky run.

## Exit 11: the row guard

Before any write, satus counts rows visible to the connected role in ordinary tables outside the system schemas, and refuses a real run when that count is greater than 10,000. Relation kinds other than `'r'`, unreadable tables, and row-level security can make the count smaller than the database. The refusal is exit `11`, and nothing is written. The [row guard post](/blog/how-satus-decides-a-database-is-too-full-to-seed) shows what is counted, what is skipped, and how `--force` bypasses it. Check `DATABASE_URL` and the readable row count before deciding whether `--force` is appropriate.

On a database whose only table holds 10,001 rows:

```
$ OPENAI_API_KEY=placeholder satus generate --rows 25
Refusing to run: this database already holds more than 10,000 rows across 1 user table(s).
  satus generate writes rows, and a database this full is usually not the one you meant
  to seed. Check DATABASE_URL.
  If it is the right database — a staging environment with real fixtures, say — re-run
  with --force.
```

`select count(*) from pile` is still 10001.

## Branching on the code

This script captures the status before `case`, so `set -e` does not exit the shell first. A form that runs `satus` and then reads `$?` under `set -e` exited 2 on the invalid plan and printed nothing. The script below was run with `set -euo pipefail`.

```bash
#!/bin/bash
set -euo pipefail
status=0
satus generate --dry-run --rows 25 > /dev/null 2>&1 || status=$?
case "$status" in
  0)  echo "plan is valid" ;;
  2)  echo "validator found errors in the plan"; exit 1 ;;
  10) echo "FK cycle with no nullable column"; exit 1 ;;
  11) echo "the readable row count exceeds 10,000"; exit 1 ;;
  *)  echo "satus failed (exit $status)"; exit 1 ;;
esac
```

Against the `char(3)` schema from the exit `2` section, `bash ci-gate.sh` prints `validator found errors in the plan` and exits 1. Against the final schema, after `code` is `text` again and `teams.owner_id` is nullable, it prints `plan is valid` and exits 0.

A dry run never exits `11`. It prints the guard warning and continues, and a validation error can still exit `2` after that warning. The `11` branch applies when the same script runs `satus generate` without `--dry-run`.

The published v0.x limits apply to every code above: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic. A dry run that exits `0` has not checked any of those.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
