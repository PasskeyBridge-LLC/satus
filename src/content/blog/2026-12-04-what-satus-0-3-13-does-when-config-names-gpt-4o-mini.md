---
slug: what-satus-0-3-13-does-when-config-names-gpt-4o-mini
title: What satus 0.3.13 does when the config still names gpt-4o-mini
seoTitle: What 0.3.13 does with a pinned gpt-4o-mini
description: satus 0.3.13 uses gpt-6-luna when no model is set. A config that still names gpt-4o-mini keeps that model and prints the 2027-01-14 shutdown line.
date: 2026-12-04
publishAt: 2026-12-04T09:00:00-05:00
author: satus.sh
tags: [cli, openai, config, seeding]
draft: false
---

`@passkeybridge/satus@0.3.13` uses `gpt-6-luna` when neither `--model` nor the `model` field in `satus.config.json` is set and the provider is OpenAI. A config that sets `"model": "gpt-4o-mini"` keeps `gpt-4o-mini`. A dry run then writes one line to stderr. The line names 2027-01-14. The plan goes to stdout, and the process exits 0. The dry run does not need `OPENAI_API_KEY`.

The choice is in [`generate.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/commands/generate.ts). `--model` wins, then `model` in `satus.config.json`, then `DEFAULT_MODELS`. The OpenAI entry in that map is `gpt-6-luna`. The stderr line is `shutdownNotice` in [`deprecations.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/providers/deprecations.ts). Each row there has `readOn: "2026-11-13"`. The transcripts quote the line the binary printed on 2026-11-22.

A generate that is not a dry run, with that config and with no `OPENAI_API_KEY`, exits 1 before the shutdown line. The key check in `generate.ts` runs first. Setting `OPENAI_API_KEY` to the placeholder `placeholder` and pointing `DATABASE_URL` at a closed port prints the shutdown line and then the connection error. The exit code is 1. No row was inserted.

`satus init` on 0.3.13, accepting every prompt's default, writes `"model": "gpt-6-luna"`. The same prompts on `@passkeybridge/satus@0.3.12` write `"model": "gpt-4o-mini"`.

Every transcript below ran on 2026-11-22 against PostgreSQL 17.12 (`PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit`), `psql` (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1), Node v24.21.0, and `@passkeybridge/satus@0.3.13`, except the 0.3.12 init. `npm view @passkeybridge/satus version` printed `0.3.13`. No provider key was set unless a command shows `OPENAI_API_KEY=placeholder`. `DATABASE_URL` for the schema sections is `postgresql://postgres:postgres@127.0.0.1:5433/model_dev`.

```
$ npm view @passkeybridge/satus version
0.3.13
$ node -v
v24.21.0
$ satus --version
0.3.13
```

```sql
select version();
```

```
 PostgreSQL 17.12 (Debian 17.12-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
(1 row)
```

## The schema

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

## No config file

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

## A config that names gpt-4o-mini

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "schema": "public",
  "profile": "saas"
}
```

Stderr:

```
! gpt-4o-mini shuts down on 2027-01-14 (OpenAI deprecations page). It comes from "model" in satus.config.json; set it to gpt-6-luna, or pass --model.
```

Stdout, exit code 0:

```
$ satus generate --dry-run --rows 25

satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0018
  orders                           25 rows  ~$0.0027

  estimated cost: $0.0045

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

The per-table figures and the total differ from the `gpt-6-luna` run. The dry-run estimate uses the price table entry for the resolved model. The formula is the one in [how the dry-run cost estimate is calculated](/blog/how-the-dry-run-cost-estimate-is-calculated). `OPENAI_PRICING` in [`openai.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/providers/openai.ts) prices `gpt-6-luna` at $0.10 per million input tokens and $0.50 per million output tokens, and `gpt-4o-mini` at $0.15 and $0.60.

## --model overrides the config

`satus generate --dry-run --rows 25 --model gpt-6-luna`, with the config above still in place, wrote nothing to stderr and exited 0. Its stdout matches the no-config dry run byte for byte, including `model:    gpt-6-luna` and `estimated cost: $0.0035`.

`--model gpt-4o-mini` keeps the model and changes the stderr sentence. Stdout matches the config run above, including `estimated cost: $0.0045`. Stderr:

```
! gpt-4o-mini shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.
```

## The ids in the shutdown list

`MODEL_SHUTDOWNS` in `deprecations.ts` names four aliases, `gpt-4o-mini`, `gpt-4o`, `gpt-4.1`, and `gpt-4.1-mini`, and these snapshot ids: `gpt-4o-mini-2024-07-18`, `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`, `gpt-4.1-2025-04-14`, `gpt-4.1-mini-2025-04-14`. Each `--model` below was a dry run of 25 rows against the same config and the same two tables. The exit code was 0. Stdout differed from the no-config run on the model line, the two per-table cost lines, and the estimated-cost line.

| `--model` | customers | orders | estimated cost | stderr |
|---|---|---|---|---|
| `gpt-4o` | `~$0.0300` | `~$0.0450` | `$0.0750` | `! gpt-4o shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.` |
| `gpt-4o-2024-08-06` | `~$0.0300` | `~$0.0450` | `$0.0750` | `! gpt-4o-2024-08-06 shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.` |
| `gpt-4o-2024-11-20` | `~$0.0300` | `~$0.0450` | `$0.0750` | `! gpt-4o-2024-11-20 shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.` |
| `gpt-4o-mini-2024-07-18` | `~$0.0018` | `~$0.0027` | `$0.0045` | `! gpt-4o-mini-2024-07-18 shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.` |
| `gpt-4.1` | `~$0.0240` | `~$0.0360` | `$0.0600` | `! gpt-4.1 shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.` |
| `gpt-4.1-2025-04-14` | `~$0.0240` | `~$0.0360` | `$0.0600` | `! gpt-4.1-2025-04-14 shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.` |
| `gpt-4.1-mini` | `~$0.0048` | `~$0.0072` | `$0.0120` | `! gpt-4.1-mini shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.` |
| `gpt-4.1-mini-2025-04-14` | `~$0.0048` | `~$0.0072` | `$0.0120` | `! gpt-4.1-mini-2025-04-14 shuts down on 2027-01-14 (OpenAI deprecations page). It comes from --model; pass --model gpt-6-luna.` |

`gpt-6-luna` is not in that list. The no-config dry run printed no stderr line.

## No key exits before the shutdown line

The config still names `gpt-4o-mini`. No provider key is set.

```
$ satus generate --rows 25

OPENAI_API_KEY is not set.
  Export it before running, or pass --dry-run to plan without calling the model.
```

The exit code is 1. Stdout was empty. The shutdown line was not printed.

```sql
select (select count(*) from customers) as customers, (select count(*) from orders) as orders;
```

```
 customers | orders 
-----------+--------
         0 |      0
(1 row)
```

## A refused connection prints the line and stops

`OPENAI_API_KEY=placeholder` and `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/none?connect_timeout=2`, same config:

```
$ OPENAI_API_KEY=placeholder satus generate --rows 25

! gpt-4o-mini shuts down on 2027-01-14 (OpenAI deprecations page). It comes from "model" in satus.config.json; set it to gpt-6-luna, or pass --model.
Failed to connect to Postgres: connect ECONNREFUSED 127.0.0.1:1
```

The exit code is 1. `generate.ts` prints the shutdown line, then connects, and only after a successful connection does it reach the live provider call. This process stopped at `ECONNREFUSED`.

## What satus init writes

Each init ran in an empty directory. Every prompt was answered with Enter, so each default stood. Both processes exited 0.

`@passkeybridge/satus@0.3.13` wrote:

```json
{
  "schema": "public",
  "profile": "saas",
  "provider": "openai",
  "model": "gpt-6-luna",
  "exclude": [],
  "telemetry": {
    "enabled": false,
    "share_failure_fingerprints": false
  }
}
```

`@passkeybridge/satus@0.3.12` wrote the same keys with `"model": "gpt-4o-mini"`. `satus generate --dry-run --rows 25` on 0.3.13, with that file as `satus.config.json` and `DATABASE_URL` still set to `model_dev`, exited 0. Stdout matched the config run above. Stderr was the same shutdown line, citing `satus.config.json`.

A 0.3.13 config that sets the provider and omits `model` resolves the default. This file:

```json
{
  "provider": "openai",
  "schema": "public",
  "profile": "saas"
}
```

produced the same stdout as the no-config dry run, including `model:    gpt-6-luna` and `estimated cost: $0.0035`, and wrote nothing to stderr.

## The model field stays when the provider flag changes

`--provider` selects the provider. The config's `model` is still the model id. With the `gpt-4o-mini` config in place, `satus generate --dry-run --rows 25 --provider anthropic` wrote nothing to stderr and exited 0. No `ANTHROPIC_API_KEY` was set. The command was a dry run. Stdout:

```
satus generate
  schema:   public
  profile:  saas
  provider: anthropic
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.1400
  orders                           25 rows  ~$0.2100

  estimated cost: $0.3500

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

Removing the config and passing `--provider anthropic` uses the Anthropic default. Stderr was empty. The exit code is 0.

```
satus generate
  schema:   public
  profile:  saas
  provider: anthropic
  model:    claude-haiku-4-5
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0140
  orders                           25 rows  ~$0.0210

  estimated cost: $0.0350

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

The three dollar figures in the pinned-model run are ten times the three figures in the default-model run. `PRICING` in [`anthropic.ts` at tag v0.3.13](https://github.com/PasskeyBridge-LLC/satus/blob/v0.3.13/packages/cli/src/generate/providers/anthropic.ts) prices `claude-haiku-4-5` at $1 and $5 per million tokens. `FALLBACK_PRICE` in that file, used for an id that matches no prefix, is $10 and $50. `gpt-4o-mini` matches no Anthropic prefix, and the shutdown list is provider-scoped, so this run prints no shutdown line.

`--provider xai` with no config file uses the xAI default. Stderr was empty. The exit code is 0. No `XAI_API_KEY` was set.

```
satus generate
  schema:   public
  profile:  saas
  provider: xai
  model:    grok-4.20-0309-non-reasoning
  rows:     25 per table
  tables:   customers -> orders

  customers                        25 rows  ~$0.0100
  orders                           25 rows  ~$0.0150

  estimated cost: $0.0250

  simulating + validating...
  customers . (dry-run)
  orders . (dry-run)

  ✓ no validation findings across 2 tables
```

The published v0.x limits still apply: multi-column `UNIQUE` constraints are not enforced during generation, cross-column arithmetic is not reconciled, and there is no `--seed`, so output is not deterministic.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
