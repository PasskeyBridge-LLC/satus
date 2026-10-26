---
slug: cost-estimates-are-guardrails-not-accounting
title: Cost estimates are guardrails, not accounting
description: Our dry-run estimator quotes two cents for a 125-row seed. Three real 125-row runs cost seven hundredths of a cent. The 31x gap is deliberate. The arithmetic.
date: 2026-09-11
publishAt: 2026-09-11T09:00:00-04:00
author: satus.sh
tags: [llm, cost, cli, openai, telemetry]
draft: false
---

This post was scheduled in our content plan under the title "What a $0.03 seed run looks like." We went to get the transcript and found that our own numbers do not support the headline. A 125-row seed does not cost three cents. It costs about seven hundredths of one, and the estimate that says otherwise is wrong on purpose.

That gap is the interesting part, so it became the post.

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

## The invoice

satus posts a small telemetry record when a run finishes. Ours is the only data in it: satus has no external paying customers yet, and all ten recorded runs fall on two of our own release-testing dates. Three of them are directly comparable, all `gpt-4o-mini`, all 125 rows, inside the same 35 minutes on 2026-07-14:

```text
 input_tokens | output_tokens | total_cost_usd | duration_ms
--------------+---------------+----------------+-------------
         1234 |           806 |       0.000669 |       21854
         1234 |           801 |       0.000666 |       18246
         1234 |           778 |       0.000652 |       18121
```

Recomputing each from the shipped price table, to check the stored figures rather than trust them:

```text
  in=1234 out=806  recomputed=$0.000669  stored=$0.000669  match=True
  in=1234 out=801  recomputed=$0.000666  stored=$0.000666  match=True
  in=1234 out=778  recomputed=$0.000652  stored=$0.000652  match=True
```

Seven hundredths of a cent. The estimate was 31 times too high.

One caveat before the analysis: those runs predate the telemetry cutback in v0.3.7, and the schema they ran against is not recoverable from the record, because table names and schema names are exactly what we stopped storing. Both shapes produced 125 rows, so the comparison is indicative rather than controlled. The direction and rough magnitude of the gap are the claim; the precise multiple is not.

## Where the 31x goes

Split by side, the estimator misses differently:

```text
input tokens:   estimator 46000 vs actual 1234  ->  37x
output tokens:  estimator 23000 vs actual  806  ->  29x
```

The input miss is structural. "80 tokens per cell" assumes prompt size scales with the number of values requested, and it does not. The prompt describes the *schema* and asks for N rows; asking for 25 rows instead of 5 changes almost nothing on the way in. Input scales with columns, roughly once per batch, not with cells.

The output miss is a units problem. 806 output tokens across 125 rows is about 6.4 tokens per row, because the model is emitting compact JSON into a tool call rather than prose. 40 tokens per *cell* is a reasonable guess for prose and a bad one for a serialized object.

Both errors point the same way, and that is not luck.

## Why we keep it wrong

`--max-cost` defaults to $1.00 and is enforced live, not just at plan time. The runner carries a budget and aborts before committing:

```ts
`Cost budget exceeded ($${budget.spentUsd.toFixed(4)} > $${opts.maxCostUsd}). Aborting before ${table.name}.`
```

For a number whose job is to stop a run before it spends money, the two failure directions are not symmetric. An estimate that is too high makes you pass a larger `--max-cost` than you strictly needed, and you notice immediately because the dry run tells you before you spend anything. An estimate that is too low lets a run sail past the ceiling you set and bill you for it, and you notice on the invoice. The first is an annoyance; the second is the exact thing the flag exists to prevent.

The same reasoning shows up one level down, in the price tables. Any model id not in the table falls back to the most expensive entry in its own table, so an unpriced model can only ever cause `--max-cost` to abort early, never to overshoot. That is a deliberate upper bound, not a claim about what any particular model costs.

We have been on the wrong side of this before. Through v0.3.6 the Anthropic price table was empty, so every Anthropic run fell through to a fallback three times the real rate for the default model, and `--max-cost` aborted runs nowhere near their cap. That was the pessimistic direction failing loudly, which is roughly the best case for a bug of that kind.

## The number nobody can estimate

Look again at the three runs. Input tokens are identical: 1234, three times. Output tokens are 806, 801, and 778, a 3.6 percent spread across three runs inside the same 35 minutes against the same schema with the same model.

That is the whole argument in one table. The input side is deterministic, because we build the prompt. The output side is a sample from a distribution, and no estimator gets to know it in advance. Anything that calls itself cost *accounting* for an LLM run is either measuring after the fact or lying about what it can see.

So satus reports two numbers and is explicit about which is which. `--dry-run` gives you a pessimistic bound to size your budget against. The live meter gives you `tokens: N in / M out   spent: $X.XXXX` from the provider's own usage figures. Both read the same rate table, which is what [we fixed in v0.3.7](/blog/v0-3-7-release-notes) after they disagreed. Neither is your invoice. Your provider's dashboard is your invoice, rates drift, and every figure in the CLI is a last-verified estimate.

## Two things we found writing this

Both are ours, and both are the kind of thing this series keeps turning up.

The estimator's input model is wrong in a fixable way. Charging input per cell is indefensible now that we have measured it; input scales per batch. A better model would be roughly a fixed schema cost per batch plus a small per-row output term, still rounded up. We have not changed it, because a guardrail that is 31x conservative is safe and a guardrail that is newly 2x conservative needs evidence we do not yet have from more than three runs.

The second is worse, and it is the reason this post exists in the form it does. Our [security page](/security) has always said telemetry is "off by default." That was true of the failure-fingerprint sharing, which is gated behind a config flag. It was not true of the run record this post is built on: through v0.3.10, `reportRun` was called unconditionally at the end of every `satus generate`, with no environment variable or config key able to stop it.

Nothing identifying was collected in that window. The payload was already the minimal one v0.3.7 cut it back to, and all ten records in the table are our own release-test runs, which is how we can publish three of them here. But "off by default" described behaviour the CLI did not have, and a privacy claim that is only mostly true is not one worth keeping.

We fixed the gap rather than the sentence. As of v0.3.11 the run record is off unless `telemetry.enabled` is set in `satus.config.json` or `SATUS_TELEMETRY=1` is exported, `DO_NOT_TRACK=1` overrides both, and `satus init` asks and defaults to no. The switch is latched once at startup and initialised to off, so a code path that forgets to configure it sends nothing rather than everything. That default is pinned by a test which loads the module fresh and asserts it, because the first version of that test passed against a build where the default had been flipped to true.

## Sources

- Estimator: `planRun` in `packages/cli/src/generate/runner.ts`
- Price tables: `packages/cli/src/generate/providers/openai.ts` and `anthropic.ts`, each carrying a last-verified date
- [OpenAI pricing](https://platform.openai.com/docs/pricing)
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Earlier, on the two numbers disagreeing: [v0.3.7 release notes](/blog/v0-3-7-release-notes)
