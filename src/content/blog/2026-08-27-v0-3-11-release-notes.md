---
slug: v0-3-11-release-notes
title: "v0.3.11: two claims the code did not support"
description: Run telemetry is now opt-in, as our security page said. Primary keys come from pg_catalog, so a read-only CI role no longer gets a false green from --dry-run.
date: 2026-08-27
author: satus.sh
tags: [release, cli, privacy, postgres]
draft: false
---

`@passkeybridge/satus@0.3.11` is on npm. Both changes are the same shape: something we published was not true of the binary, and the fix went into the binary rather than the sentence.

## Run telemetry is opt-in

[satus.sh/security](/security) has said "Telemetry. Off by default" since the page went up. That was true of one thing and false of another.

The narrow opt-in, `telemetry.share_failure_fingerprints`, was genuinely gated: it adds a SHA-256 of the normalised schema shape and the name of the first validator rule that fired, and it did nothing unless you turned it on.

The run record was not gated at all. `reportRun` was called unconditionally at the end of every `satus generate`, and there was no config key, environment variable, or flag that could stop it.

What that record contains has not changed, and it is worth being precise about the blast radius: a random run UUID, the CLI version, provider, model, profile name, the *number* of tables touched, total rows, token totals, an estimated spend, a duration, and on failure a fixed-vocabulary error class such as `pg_23505`. No table names, no column names, no schema name, no row data, no raw error text. v0.3.7 cut it to exactly that. Nothing identifying was collected in the window, and all ten records in the table are our own release-test runs.

So this was not a data leak. It was a promise that did not match the product, which is the thing we have spent the last month systematically finding and fixing.

As of 0.3.11 the run record is off unless you ask for it:

```jsonc
// satus.config.json
{ "telemetry": { "enabled": true } }
```

```bash
SATUS_TELEMETRY=1 satus generate
```

`DO_NOT_TRACK=1` overrides both and always wins, per the [consoledonottrack.com](https://consoledonottrack.com) convention. `satus init` now asks, and defaults to no. `share_failure_fingerprints` is a second opt-in layered on top and does nothing unless `enabled` is also true.

The switch is latched once at startup and initialised to off, so a code path that never configures it sends nothing rather than everything. That default is pinned by a test that loads the module fresh and asserts it. The first version of that test did not: it called the configure function before asserting, so it passed against a deliberately broken build where the default had been flipped to `true`. Catching that took a mutation test, which is the argument for running them.

## Primary keys are read from the catalogs

We [wrote last week](/blog/information-schema-is-privilege-filtered) about `information_schema` being privilege-filtered, and about the foreign-key introspection that has read `pg_catalog` since v0.2.0 for exactly that reason.

The same file had two other CTEs. `v_pks` and `v_uniques` still went through `information_schema.table_constraints`, whose privilege predicate accepts `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` but not `SELECT`.

A role holding only `SELECT` therefore saw every table as having no primary key and no unique columns. Nothing raised. And the path is reachable rather than theoretical: `--dry-run` writes nothing, so a read-only database credential is the natural thing to hand a CI job, and `uniqueColumns` is what gates the validator's `unique_duplicate` check.

Verified on PostgreSQL 16.13 against a `varchar(4) unique` column, where the simulator's string capping makes duplicates certain. As a read-only role, v0.3.10:

```text
  ✓ no validation findings across 1 tables
EXIT=0
```

Same command, same role, 0.3.11:

```text
  findings: 4 error / 0 warn
  error currencies.code                      unique_duplicate   x4  rows[1,2,3+]
         Duplicate value in UNIQUE column "code" within the same batch
EXIT=2
```

A CI gate that returns a false green is worse than no gate. Both CTEs now read `pg_constraint`. Primary-key column order comes from `unnest(conkey) with ordinality`, and single-column uniques are selected with `cardinality(conkey) = 1`, which preserves the existing v0.x limitation exactly: `UNIQUE` constraints are seen, bare `CREATE UNIQUE INDEX` is not.

If you run `satus generate --dry-run` in CI with a read-only role, upgrade. If your CI role can write, you were never affected, because `INSERT` satisfies the predicate.

## Also in this release

Anthropic shipped structured outputs (`output_config.format`) after our provider was written, and the supported-model list includes the `claude-haiku-4-5` family we default to. Our source comment asserted no such API existed. That comment is corrected; the behaviour is unchanged, because tool-use forcing works and costs no parsing, and switching means re-verifying the `--max-cost` accounting against a response shape we have never measured.

While checking that, one more gap: the OpenAI provider sets `strict: true` on its schema and the Anthropic provider sets no equivalent, so our Anthropic tool calls are schema-shaped rather than schema-guaranteed. The validator catches the difference before anything is written, but relying on it for something the API will enforce is weaker than it needs to be. That one is outstanding.

## Upgrading

```bash
npm install -g @passkeybridge/satus@0.3.11
```

No config migration. If you had `telemetry.share_failure_fingerprints` set to `true`, note that it now requires `telemetry.enabled` alongside it to have any effect, which means an existing config sends less than it used to rather than more.

Full detail in [CHANGELOG.md](https://github.com/passkeybridge/satus/blob/main/CHANGELOG.md).
