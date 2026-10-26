---
slug: satus-0-3-11-exit-codes
title: The exit codes satus 0.3.11 returns, and what each one means in CI
seoTitle: satus 0.3.11 exit codes and what each one means in CI
description: satus 0.3.11 exits 0, 1, 2, 10 or 11. Each code reproduced against PostgreSQL 17, with the message it prints and the response a CI pipeline should take.
date: 2026-11-13
publishAt: 2026-11-13T09:00:00-05:00
author: satus.sh
tags: [cli, ci, postgres, seeding]
draft: false
---

`@passkeybridge/satus@0.3.11` exits with one of five codes: `0`, `1`, `2`, `10` and `11`. They are defined in [`exit-codes.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/exit-codes.ts), whose header calls them "a public contract": a pipeline branches on them, so values are only ever added. The named codes exist so that a pipeline can tell "satus declined to act" from "satus tried and failed". This post reproduces each code with the shipped CLI and shows the output that goes with it. Every transcript below ran on PostgreSQL 17.11 with `psql` 17.11, against `@passkeybridge/satus@0.3.11`, with no provider key in the environment.

| code | name | meaning |
|---|---|---|
| `0` | | success; for `--dry-run`, no validator errors |
| `1` | `E_GENERAL` | anything unclassified: configuration, connection, provider or database error |
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

With no `--dsn`, no `DATABASE_URL` and no `satus.config.json`:

```
$ satus generate --dry-run
No database connection configured.
  Pass --dsn, set $DATABASE_URL, or run `satus init`.
```

A real run, without `--dry-run`, needs a provider key. The key is checked before satus connects to the database:

```
$ satus generate --rows 25
OPENAI_API_KEY is not set.
  Export it before running, or pass --dry-run to plan without calling the model.
```

An unknown provider:

```
$ satus generate --dry-run --rows 25 --provider gemini
Unknown --provider: gemini. Use openai | anthropic.
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

On this machine `localhost` resolves to both `::1` and `127.0.0.1`. When both refuse, Node 20.19 reports the failure as an `AggregateError` with an empty message, and satus prints only the prefix. The exit code is still `1`. If you see `Failed to connect to Postgres:` followed by nothing, retry with an IP address to see the reason.

Exit `1` also covers failures during a real run: a provider error, a database error on insert, a `--max-cost` abort. Each of those rolls back the transaction, so a failed real run leaves the database as it was. A pipeline should treat `1` as a failure that needs a person to read the log.

## Exit 0 and exit 2: the dry run as a gate

`--dry-run` plans the run, simulates rows without calling a model, and validates them against foreign keys, types, `NOT NULL`, varchar lengths and single-column `UNIQUE` constraints. With no errors it exits `0`:

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

Exit `2` means the dry run itself worked and found something wrong with the plan. In CI, it is the code to fail a pull request on. With `--json`, the same result is a single object on stdout and the exit code does not change:

```
$ satus generate --dry-run --rows 25 --json > result.json 2>/dev/null
```

```
$ jq -c "{status, errors: .validation.error_count}" result.json
{"status":"dry_run_invalid","errors":24}
```

The `status` field is `dry_run_invalid` when the exit is `2` and `dry_run` when it is `0`.

## Exit 10: a cycle satus cannot break

satus inserts parents before children. When two tables reference each other, it needs one foreign key it can leave `NULL` on insert and fill in after both tables are seeded, inside the same transaction. Revert `code` to `text` and add a cycle where both columns are `NOT NULL`:

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

The `teams_owner_fk` constraint is `deferrable initially deferred`, and satus still exits `10`. In 0.3.11 the cycle breaker looks for a nullable foreign-key column and nothing else. A column default does not help either:

```sql
alter table teams alter column owner_id set default 0;
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

The [troubleshooting](/docs/troubleshooting) page says the same: a column `DEFAULT` or a `DEFERRABLE INITIALLY DEFERRED` constraint does not break the cycle, and satus still exits `10`. Making one FK column on the cycle nullable is the fix that works in 0.3.11:

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

The plan now has a `cycles:` line naming the edge satus will fill in after the insert. Exit `10` happens during planning, before any write, so a pipeline can treat it as a schema problem to fix rather than a flaky run.

## Exit 11: the row guard

Before any write, satus counts the rows in every user table in the database and refuses above 10,000. That refusal is exit `11`, and nothing is written. The [row guard post](/blog/how-satus-decides-a-database-is-too-full-to-seed) shows what is counted, what is skipped, and how `--force` bypasses it. In CI, `11` almost always means the job's `DATABASE_URL` points at the wrong database.

## Branching on the code

A CI step can act on each code. This script runs the dry run and maps the exit code to a message:

```
$ cat ci-gate.sh
satus generate --dry-run --rows 25 > /dev/null 2>&1
case $? in
  0)  echo "plan is valid" ;;
  2)  echo "validator found errors in the plan"; exit 1 ;;
  10) echo "FK cycle with no nullable column"; exit 1 ;;
  11) echo "DATABASE_URL points at a database with data in it"; exit 1 ;;
  *)  echo "satus failed"; exit 1 ;;
esac
```

Against the `char(3)` schema from the exit `2` section:

```
$ bash ci-gate.sh
validator found errors in the plan
```

Against the final schema, after the cycle fix:

```
$ bash ci-gate.sh
plan is valid
```

A dry run never exits `11`: it prints the guard warning and continues, as the row guard post shows. The `11` branch applies when the same script runs `satus generate` without `--dry-run`.

The published v0.x limits apply to every code above: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic. A dry run that exits `0` has not checked any of those.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
