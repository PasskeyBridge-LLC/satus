---
slug: agent-mode-postponed
title: "Agent mode, postponed to v0.5"
description: Why satus is shipping an opt-in agent mode in v0.5 instead of v0.3, what it will and will not do, and how the 90-day evidence window between now and then shapes the design.
date: 2026-06-23
author: satus.sh
tags: [roadmap, agents, design, postgres]
draft: false
---

> **Editor's note (2026-07-16):** The version-line dates below (v0.4 mid-July, v0.5 late September, v0.6 open) reflect the June 2026 plan and have shifted. Post-2026-07-03 renumber: v0.3.3 = GitHub Action, v0.4.0 = agent mode. Anthropic support shipped in v0.3.0. Gemini is still not supported. See the [v0.3.5 release notes](/blog/v0-3-5-release-notes) for current status.



The most common feature request we get, after "support my schema", is some version of "can it just figure it out?". The user runs `satus seed`, the [dry-run validator](/blog/dry-run-validation) flags an enum mismatch or a foreign key pointing at a row the planner never produced, and instead of reading the error and editing a YAML profile, they would like the tool to read its own output and propose the fix. That is a reasonable thing to want. It is also a category of feature that, done badly, would undermine the one thing satus is currently good at: producing the same rows on the same schema on every run, with no surprises.

So we are committing to it, and we are committing to not shipping it yet. `satus agent` lands in v0.5, after 90 days of telemetry on v0.3 and v0.4. This post explains the shape of the feature, why the delay is the point rather than a concession, and what the deterministic CLI will and will not stop being.

## What agent mode is

`satus agent` is an opt-in subcommand. It opens an interactive session in the terminal, reads the same schema your `satus seed` invocation would read, and runs a bounded tool-using loop on top of the primitives the CLI already exposes: introspection, topological sort, the offline dry-run validator, error-context retrieval, profile patching, and seeding. The model never writes arbitrary SQL. It calls functions that already exist in the codebase, with the same zod-validated inputs the CLI uses today.

The tool surface is small on purpose:

```text
read-only (auto-run):
  introspect_schema     read tables, columns, FKs, constraints, enums
  topo_sort             return insert order + cycle list
  dry_run               run the offline validator against the current profile
  read_error_context    fetch the last validation failure with row samples
  propose_profile_patch return a YAML diff (no write)

side-effectful (require approval):
  apply_profile_patch   write the patch to disk
  seed                  generate rows and COPY into the target database
```

Read-only tools execute without prompting. Anything that touches the filesystem or the database shows a diff or a row-count summary and waits for `y/n`. There is no "auto-apply" flag. A non-interactive `--policy` file exists for scripted use, but `seed` defaults to require an explicit acknowledgement even there.

The loop itself is the [AI SDK](https://ai-sdk.dev/docs/agents/building-agents.md) `generateText` plus `tool()` plus `stopWhen: stepCountIs(50)` shape, with a small system prompt (~1.5K tokens) that points at the existing reference material on [cycle resolution](/blog/cyclic-fks-in-the-wild), [the dry-run validator](/blog/dry-run-validation), and [enum distributions](/blog/enum-types-that-grew-up). No hidden skill loader. No implicit state. Every model decision is in a transcript at `.satus/agent/<run-id>.jsonl` that you can grep, replay, or paste into a bug report.

## Where it earns its keep

The deterministic CLI is already fast at the mechanical work. An agent does not make `COPY` faster or `topo_sort` cheaper. It earns its keep at exactly four places, all of which today land in support tickets as "it failed on my schema":

1. **Validation repair.** Dry-run throws `EnumOutOfDomain` on `order_status`. The agent reads the error, proposes a profile patch that adds the missing label with a sensible weight, re-runs `--dry-run`, shows the diff, asks to apply.
2. **Profile authoring from a cold schema.** Point at a database with 80 tables it has never seen. It introspects, clusters tables by FK neighbourhood, proposes a profile, and dry-runs until the validator is clean.
3. **Cycle resolution.** When the topo sort surfaces a cycle, the agent picks a deferral strategy (nullable insert plus UPDATE pass, or batched two-phase), explains the trade-off in plain text, and writes it into the profile. The decision tree is bounded; LLMs handle it well.
4. **Intent translation.** "Seed me a six-month e-commerce dataset with weekend traffic spikes and a Black Friday burst" is a prompt, not a config file. The agent translates it into row counts and timestamp distributions over the existing primitives.

The connecting thread is that every one of these is a place where today's user has to context-switch out of the CLI, read docs, edit YAML, re-run. The agent collapses the loop. It does not replace the loop.

## Where it explicitly does not help

This is the part that decides whether the feature is worth shipping at all.

`satus seed` in CI, against PR-preview databases, must remain a deterministic command with no LLM in the hot path. That is most of what people actually do with satus. The dry-run is part of the same promise: zero spend, zero writes, exit code 0 or not. An agent that silently rewrote a profile, or that inserted an LLM call into a CI run that used to be free, would be a regression dressed as a feature.

So `satus agent` is the authoring and repair surface. `satus seed`, `satus dry-run`, and the existing flags are the production surface. We will reinforce that separation in docs, in the launch post, and in the binary itself: the agent subcommand prints a one-line reminder on first run that it is not the CI tool.

## Why the 90-day wait

The honest reason is that we do not yet know the failure modes we should be designing the agent to handle. We know the categories from inbound tickets, but the long tail (which constraint patterns, which schema shapes, which provider conventions) is the work. Building the loop now means writing prompts against our guesses. Building it in 90 days means writing prompts against an anonymised eval set drawn from real `satus generate --dry-run` failures, with user consent, with row data stripped at the source.

The instrumentation lands in v0.4 in the next two weeks: SHA-256 fingerprints of normalised DDL, the validator class that fired, the sequence of CLI invocations leading to it. No row contents. Off by default. The opt-in prompt is the same one that already gates the existing telemetry. We will publish the eval-set summary statistics in a v0.4 follow-up post.

The other half of the wait is unglamorous. Versioned prompts in the repo, an A/B harness that diffs a prompt change against the fixture set, transcripts that survive a `git bisect`. Without that scaffolding, every prompt edit is a regression risk and there is no way to tell whether the model got worse or the schema fixture got harder. Agent maintenance is mostly this scaffolding; the loop itself is two weeks of work.

## What this commits us to

Concretely:

- v0.4 (mid-July): telemetry hooks for failure-mode collection, opt-in, no row data.
- v0.5 (late September target): `satus agent`, BYO-key for OpenAI, Anthropic, and Gemini, interactive REPL, approval gates, transcripts, non-interactive policy file.
- v0.6 (open): hosted-key tier at the previously discussed +$10/mo, which is what makes agent mode usable for people who do not want to manage a third-party API key.

What we are not committing to in v0.5: a chat UI on the marketing site, planner/executor splits, RAG over user docs, auto-apply without approval, or a GitHub Action variant. Those are real ideas. They are not the v1 of this feature.

## Where to push back

The two assumptions most likely to be wrong are the surface and the wait. If the right surface is a GitHub Action that runs on every preview deploy rather than a CLI subcommand, we want to know before we build the wrong thing. If the 90-day evidence window is overcautious and we are leaving repair-loop value on the floor in the meantime, we want to know that too.

Both questions get easier to answer with telemetry. If you run satus and would let us see anonymised failure classes from your dry-runs, the opt-in flag lands in v0.4. If you have an opinion on the surface, the [GitHub issue tracker](https://github.com/PasskeyBridge-LLC/satus) is the right place; we read everything there.

The deterministic CLI is the product. The agent is a layer on top of it. v0.5 is when that layer ships.

## References

- [satus dry-run validator (v0.3)](/blog/dry-run-validation)
- [Cyclic foreign keys in the wild](/blog/cyclic-fks-in-the-wild)
- [Enum types that grew up](/blog/enum-types-that-grew-up)
- [v0.3.0 release notes](/blog/v0-3-0-anthropic-and-machine-readable-output)
- [AI SDK · Building Agents](https://ai-sdk.dev/docs/agents/building-agents.md)
- [AI SDK · Loop control and `stopWhen`](https://ai-sdk.dev/docs/agents/loop-control.md)
- [satus on GitHub](https://github.com/PasskeyBridge-LLC/satus)
