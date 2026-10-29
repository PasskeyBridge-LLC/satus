---
slug: how-the-dry-run-cost-estimate-is-calculated
title: How the dry-run cost estimate is calculated
description: A 125-row dry run is quoted at two cents. Three measured runs cost seven hundredths of a cent. The estimator over-quotes by 31x; this post shows the arithmetic.
date: 2026-09-11
publishAt: 2026-09-11T09:00:00-04:00
author: satus.sh
tags: [llm, cost, cli, openai, telemetry]
draft: false
---

This post was scheduled in our content plan under the title "What a $0.03 seed run looks like." A 125-row seed costs about seven hundredths of a cent. The dry-run estimate for that row count is $0.0207, about two cents. The estimator quotes high on purpose.

## The estimate

`satus generate --dry-run` prices a run before spending anything. Against a five-table SaaS schema with 23 columns, at the free-tier cap of 25 rows per table:

```text
satus generate
  schema:   public
  profile:  saas
  provider: openai
  model:    gpt-4o-mini
  rows:     25 per table
  tables:   orgs -> subscriptions -> usage_events -> users -> memberships

  orgs                             25 rows  ~$0.0036
  subscriptions                    25 rows  ~$0.0045
  usage_events                     25 rows  ~$0.0045
  users                            25 rows  ~$0.0045
  memberships                      25 rows  ~$0.0036

  estimated cost: $0.0207
```

Two cents. The model behind that number is four lines:

```ts
const cells = t.columns.length * opts.rowsPerTable
const inputTokens = cells * 80
const outputTokens = cells * 40
```

23 columns times 25 rows is 575 cells, so 46,000 input tokens and 23,000 output tokens. At `gpt-4o-mini` rates of $0.15 and $0.60 per million, that is $0.0069 plus $0.0138, or $0.0207. The printed figure is exactly the arithmetic, with no fudge factor.

## The measured runs

satus posts a small telemetry record when a run finishes. Ours is the only data in it: satus has no external paying customers yet, and all ten recorded runs fall on two of our own release-testing dates. Three of them are directly comparable, all `gpt-4o-mini`, all 125 rows, inside the same 35 minutes on 2026-07-14:

```text
 input_tokens | output_tokens | total_cost_usd | duration_ms
--------------+---------------+----------------+-------------
         1234 |           806 |       0.000669 |       21854
         1234 |           801 |       0.000666 |       18246
         1234 |           778 |       0.000652 |       18121
```

Recomputing each from the shipped price table checks the stored figures:

```text
  in=1234 out=806  recomputed=$0.000669  stored=$0.000669  match=True
  in=1234 out=801  recomputed=$0.000666  stored=$0.000666  match=True
  in=1234 out=778  recomputed=$0.000652  stored=$0.000652  match=True
```

Seven hundredths of a cent. The estimate was 31 times too high.

One caveat before the analysis: those runs predate the telemetry cutback in v0.3.7. v0.3.7 removed table names and schema names from the payload, so the schema these runs used is absent from the record. Both shapes produced 125 rows. The comparison uses that shared row count. The claim is the direction and the rough size of the gap. The 31x multiple depends on a schema the record does not contain.

## Where the 31x goes

Split by side, the estimator misses differently:

```text
input tokens:   estimator 46000 vs actual 1234  ->  37x
output tokens:  estimator 23000 vs actual  806  ->  29x
```

The input miss is structural. The prompt describes the *schema* and asks for N rows. "80 tokens per cell" prices the prompt as if it grew with every value requested. Asking for 25 rows changes almost nothing on the input side compared with asking for 5. Input scales with columns, roughly once per batch.

The output miss is a units problem. 806 output tokens across 125 rows is about 6.4 tokens per row. The model emits compact JSON in a tool call. 40 tokens per *cell* fits a prose guess and overshoots a serialized object.

Both errors overestimate.

## Why we keep it wrong

`--max-cost` defaults to $1.00. The runner carries a budget and aborts before committing:

```ts
`Cost budget exceeded ($${budget.spentUsd.toFixed(4)} > $${opts.maxCostUsd}). Aborting before ${table.name}.`
```

An estimate that is too high leads you to pass a larger `--max-cost` than the run needs. The dry run prints that number before any spend. An estimate that is too low lets a run pass the ceiling you set and bill past it. You see that on the provider invoice. `--max-cost` exists to stop a run that would spend past the ceiling.

The same bound is in the price tables. Any model id absent from the table falls back to the most expensive entry in its own table. An unpriced model therefore makes `--max-cost` abort early. The fallback is an upper bound on the price used for that model.

Through v0.3.6 the Anthropic price table was empty, so every Anthropic run fell through to a fallback three times the real rate for the default model, and `--max-cost` aborted runs that were still under the cap.

## Output token counts on three identical runs

Input tokens are identical across the three runs: 1234, 1234, and 1234. Output tokens are 806, 801, and 778, a 3.6 percent spread across three runs inside the same 35 minutes against the same schema with the same model.

The input count is fixed, because we build the prompt. The output count is a sample from a distribution. The estimator does not have the output token count before the provider returns it.

satus prints two figures. `--dry-run` prints a high estimate for sizing `--max-cost`. The live meter prints `tokens: N in / M out   spent: $X.XXXX` from the provider's usage figures. Both read the same rate table. [v0.3.7](/blog/v0-3-7-release-notes) put the estimator and the live meter on that shared table after the two figures disagreed. The provider dashboard is the invoice. Rates drift, and every figure in the CLI is a last-verified estimate.

## Two findings from the measurement

The estimator's input model charges input per cell. The measurement shows input scales per batch. A closer model is a fixed schema cost per batch plus a small per-row output term, still rounded up. We have not changed the estimator. The current model over-quotes by 31x, which keeps `--max-cost` on the high side of the real spend. A model that over-quotes by about 2x needs measurements from more than these three runs.

The [security page](/security) says telemetry is "off by default." Failure-fingerprint sharing is gated behind a config flag, and that flag defaults to off. The run record this post uses was separate through v0.3.10: `reportRun` ran at the end of every `satus generate`, and no environment variable or config key stopped it.

Nothing identifying was collected in that window. The payload was already the minimal one v0.3.7 cut it back to, and all ten records in the table are our own release-test runs, which is how we can publish three of them here. "Off by default" did not describe that run record.

v0.3.11 makes the run record match that sentence. The record is off unless `telemetry.enabled` is set in `satus.config.json` or `SATUS_TELEMETRY=1` is exported. `DO_NOT_TRACK=1` overrides both. `satus init` asks and defaults to no. The switch is latched once at startup and starts off, so a code path that forgets to configure it sends nothing. A test loads the module fresh and asserts that default. The first version of that test passed against a build where the default had been set to true.

## Sources

- Estimator: `planRun` in `packages/cli/src/generate/runner.ts`
- Price tables: `packages/cli/src/generate/providers/openai.ts` and `anthropic.ts`, each carrying a last-verified date
- [OpenAI pricing](https://platform.openai.com/docs/pricing)
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Earlier, on the two numbers disagreeing: [v0.3.7 release notes](/blog/v0-3-7-release-notes)
