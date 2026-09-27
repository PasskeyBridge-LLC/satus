---
slug: dry-run-validation
title: A $0 dry-run that catches FK and constraint bugs before the LLM call
description: satus 0.3 ships an offline --dry-run that simulates LLM output and validates against your live Postgres metadata. No API key, no writes, no spend.
date: 2026-06-20
author: satus.sh
tags: [postgres, seeding, validation, ci]
draft: false
---

The most expensive bug in an LLM-backed seed run is the one you only discover after the LLM call. You pay for the tokens, you pay for the wall-clock wait, and then the planner trips on a NOT NULL column or a foreign key that points at a row the simulator never produced. The fix is small. The feedback loop is not.

`satus generate --dry-run` in 0.3 turns that loop into a free, deterministic check. It introspects the live schema, swaps the real LLM provider for an offline simulator, generates synthetic rows that conform to the JSON schema the planner already builds, and runs the same validator the live path uses. No API key required. No rows inserted. Exit code 0 if the plan is sound, 2 if the validator finds something.

## What it actually does

The end-to-end smoke run on a three-table schema with a foreign-key cycle, captured verbatim from the terminal:

```text
$ satus generate --dsn "$PG" --schema preflight \
    --profile saas --rows 10 --dry-run --verbose

satus generate
  schema:   preflight
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     10 per table
  tables:   orgs -> projects -> users
  cycles:   orgs.primary_user_id -> users (deferred)

  orgs                             10 rows  ~$0.0011
  projects                         10 rows  ~$0.0014
  users                            10 rows  ~$0.0014

  estimated cost: $0.0040

  simulating + validating...
  orgs . (dry-run)
  projects . (dry-run)
  users . (dry-run)

  ✓ no validation findings across 3 tables
```

Five things happened in that run, in order, and none of them touched the network or the database beyond reading the catalog:

1. **Introspection.** `pg_constraint` walked, columns read, types resolved.
2. **Cycle detection.** `orgs.primary_user_id` → `users.id` was identified as a back-edge and marked deferred. The mechanics of that pass are covered in [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild).
3. **Topological sort.** `orgs → projects → users`, with the deferred edge filled in pass 2.
4. **Cost estimate.** Computed from the real provider's published per-token pricing, then printed. No tokens are actually sent.
5. **Simulate + validate.** Each batch is synthesized by a deterministic provider, foreign keys are back-patched across the deferred edge against synthesized primary keys, and the validator checks the combined rows against the live catalog.

## What the validator catches

Five finding classes, each grounded in metadata the live planner already has:

- **NOT NULL violations.** Any nullable=false column whose generated value is null.
- **Type and range mismatches.** Integers outside int2/int4/int8 bounds, malformed UUIDs, JSON that does not parse.
- **`varchar(n)` overflow.** Values whose length exceeds the declared limit.
- **Foreign keys with no parent.** Generated FK values that do not match any primary key in the synthesized pool, including across deferred back-edges.
- **Single-column uniqueness collisions inside a batch.** Duplicate values on a `UNIQUE` column from one generate call.

What it does **not** catch, and the honest reason why:

- **Semantic nonsense.** `budget = -47000` passes a CHECK-less integer column. The simulator does not know that budgets are positive; only the LLM does.
- **Cross-batch uniqueness across multiple generate calls.** The dry-run validates one run at a time.
- **Triggers and CHECK constraints.** These are evaluated by Postgres during the real insert. The dry-run does not execute them.

If your goal is "did I configure satus correctly for this schema?", the dry-run is a complete answer. If your goal is "is the data realistic?", you still need the live run.

## Why it is worth shipping

The cost of a missed configuration bug used to be one full LLM round-trip per iteration. Now it is zero. That changes who runs satus and when. A reviewer on a pull request can run the dry-run against a feature-branch schema without an API key. CI can gate every migration on `satus generate --dry-run`, exit non-zero on findings, and never spend a token. The 7-test unit suite in `validate.test.ts` keeps the finding classes themselves honest across releases.

For schemas where the dry-run reports zero findings, the next live run will not fail for any of the reasons the dry-run knows how to check. That is a narrower guarantee than "the seed will succeed", but it is the largest guarantee any offline tool can honestly make.

## References

- Source: [`packages/cli/src/generate/validate.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/validate.ts) and [`simulate.ts`](https://github.com/PasskeyBridge-LLC/satus/blob/main/packages/cli/src/generate/simulate.ts).
- Cycle handling, in depth: [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild).
- The 0.3 release notes: [v0.3.0 — Anthropic and machine-readable output](/blog/v0-3-0-anthropic-and-machine-readable-output).
- PostgreSQL documentation, [pg_catalog.pg_constraint](https://www.postgresql.org/docs/current/catalog-pg-constraint.html).

—the satus.sh team
