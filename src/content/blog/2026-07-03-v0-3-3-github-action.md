---
slug: v0-3-3-github-action
title: "Roadmap: v0.3.3 ships the GitHub Action, and v0.5 becomes v0.4"
seoTitle: Roadmap: v0.3.3 ships the GitHub Action, v0.5 becomes v0.4
description: What the next satus release will and will not do, why the GitHub Action is a 0.3.x patch and not a 0.4 line item, and how the version numbers shift.
date: 2026-07-03
author: satus.sh
tags: [roadmap, ci, github, release]
draft: false
---

> **Editor's note (2026-08-05):** This post references `passkeybridge/satus-action@v1` on the GitHub Marketplace. The Action was never published as a standalone Marketplace repo; it lives in the main repo and is referenced as `passkeybridge/satus/packages/action@main`. YAML snippets below have been updated to the working reference.
**Update 2026-07-15: superseded by the [v0.3.3 release notes](/blog/v0-3-3-release-notes).** The Action shipped as designed; this post stays as the pre-release design record.

This is a roadmap post, not a release announcement. The GitHub Action described below has not shipped yet. The current published CLI is `@passkeybridge/satus@0.3.2`. When v0.3.3 lands on npm, a proper changelog post replaces this one at a different slug; this post stays as the design record.

The short version: the next satus release is **v0.3.3**, and it ships an official GitHub Action that runs `satus generate` inside a PR-preview workflow. It is deliberately a 0.3.x patch, not a 0.4 line item, because it wraps the existing CLI rather than changing what the CLI does. As a consequence, the release we previously labeled **v0.5 (agent mode)** in [Agent mode, postponed to v0.5](/blog/agent-mode-postponed) is renumbered to **v0.4.0**. Same feature, same 90-day evidence window, one fewer digit.

## Why an Action, and why now

The most common inbound request that is not "support my schema" is some variant of "how do I run this on every PR". Preview databases are already the default in a good chunk of the TanStack / Vercel / Supabase / Neon / Turso preview-branch world. The friction today is that `satus generate` requires a shell, a `DATABASE_URL`, and a provider key sitting in the right environment. That is fine on a laptop and awkward in CI.

We are being careful not to overstate this signal. We do not yet have telemetry that tells us what fraction of installs are trying to wire satus into GitHub Actions on their own; the copy in our own content plan claimed "60% of early users" and we are retiring that number because we cannot cite it. What we can cite is the shape of the questions in our inbox and the shape of the failure modes when people try to script the CLI with `run: npx satus generate` and no timeout, no cache, no key redaction. The Action exists to make the common case boring.

## What v0.3.3 will contain

The release is deliberately narrow. Everything below is scoped, not shipped:

- `packages/action/`—a composite GitHub Action published to the Marketplace as `passkeybridge/satus/packages/action@main`. Composite means no Docker image, no container startup cost, no root filesystem writes; it is three shell steps that install Node, run `npx @passkeybridge/satus@<pinned-version> generate`, and upload the run manifest as a workflow artifact.
- `action.yml`—inputs for `database-url` (required, always passed as a secret), `rows`, `profile`, `provider`, `model`, `max-cost`, `dry-run`, `working-directory`, and `satus-version` (defaults to the latest 0.3.x). Outputs the `run-id`, `tables-seeded`, `rows-inserted`, `tokens-in`, `tokens-out`, and `spent-usd` fields so downstream steps can gate on cost.
- One integration test in `.github/workflows/action-selftest.yml` that stands up an ephemeral Postgres service container, runs the Action against the `pagila` fixture from our [corpus audit](/blog/introducing-the-log), and asserts a clean `--dry-run` followed by a non-empty insert.
- Docs at `/docs/github-action` on the marketing site, with a full example workflow and the security notes below.
- A `CHANGELOG.md` entry and a matching post at `/blog/v0-3-3-release-notes` on the day of the npm publish.

Nothing about the CLI's semantics changes. The Action calls the same binary you already run locally with the same flags. If it works on your laptop, it works in the Action; if it fails in the Action, it fails on your laptop.

## The intended workflow shape

The point of a composite action is that the caller writes a small amount of YAML and gets a lot of behaviour. This is the shape we are targeting for the launch example:

```yaml
name: Seed preview database
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  seed:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: passkeybridge/satus/packages/action@main
        with:
          database-url: ${{ secrets.PREVIEW_DATABASE_URL }}
          rows: 250
          profile: saas
          max-cost: '0.50'
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Three semantically-load-bearing choices in that block are worth spelling out:

1. **`database-url` is an input, not an env var.** GitHub redacts inputs in logs the same way it redacts env vars, but making it an input means it is visible in the Action's own schema and shows up as a required field in the Marketplace UI. Someone copying the snippet is less likely to leave it empty by accident.
2. **`max-cost` is required to be a string.** YAML parses `0.5` as a float, and the CLI's zod validator expects a `string` for the `--max-cost` flag so it can normalize the format itself. The Action forwards it verbatim.
3. **The provider key stays in `env:`, not `with:`.** The CLI reads `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from the environment already ([v0.3.0 shipped that in June](/blog/v0-3-0-anthropic-and-machine-readable-output)); the Action does not touch the key. That keeps the key off the Action's public input schema and means a compromised Action version cannot exfiltrate it through the input surface.

## What we are choosing not to build

This is where a small release stays small.

- **No hosted-key mode.** If you want satus in CI without a BYO API key, that is the tier we described in the [agent-mode roadmap](/blog/agent-mode-postponed) and it does not land with v0.3.3.
- **No auto-commit of generated data.** The Action does not open a follow-up PR with a SQL dump. Seed data belongs in the ephemeral preview database, not in the git history.
- **No cache of previously-generated rows.** Every invocation regenerates. Caching row content in Actions cache would leak whatever distribution the LLM produced, and the cache-key correctness problem (schema hash + profile hash + provider version) is not worth solving for a first release.
- **No matrix examples over multiple providers.** The docs will show one OpenAI and one Anthropic example. If you want both in one workflow, the CLI has always let you set `--provider` per invocation; that predates the Action.
- **No GitLab CI, no CircleCI, no Buildkite equivalent.** The CLI already runs anywhere Node runs; the Action is a convenience layer for the single largest CI host, not a portability layer.

## The renumbering, briefly

`agent-mode-postponed` committed to three future releases: v0.4 (telemetry hooks), v0.5 (agent mode), v0.6 (hosted keys). That numbering was written before the Action was on the table. Under the new plan:

```text
old            new           contents
────           ────          ────────
v0.3.3         v0.3.3        GitHub Action (this post)
v0.4           (folded)      telemetry hooks land inside v0.3.3
v0.5           v0.4.0        satus agent, opt-in, interactive
v0.6           v0.5.0        hosted-key tier
```

Telemetry-hook collection (SHA-256 fingerprints of normalized DDL, validator class, invocation sequence; no row contents; opt-in) is small enough to land inside v0.3.3 alongside the Action. That is the only substantive change to the previously-published plan. The 90-day evidence window for the agent, the tool surface, the approval gates, and everything else in the earlier post stand.

## Timeline and honesty

Target for v0.3.3 on npm: **2026-07-10 to 2026-07-11**. That is the week after next, not next week; the intervening week is reserved for the telemetry-hook work that lands in the same release. If it slips, this post gets a dated update; it does not get quietly rewritten. When the release lands, `/blog/v0-3-3-release-notes` will link back here, and the changelog on this page will read `Superseded by v0.3.3 release notes` with a link.

If you have a preview-database workflow that satus should behave well inside and does not today, the [GitHub issue tracker](https://github.com/passkeybridge/satus) is the right place. We read everything there.

## References

- [Agent mode, postponed to v0.5](/blog/agent-mode-postponed)—original roadmap; version numbers now shift by one minor as described above
- [v0.3.0 release notes](/blog/v0-3-0-anthropic-and-machine-readable-output)—provider auto-detect and env-var conventions the Action inherits
- [Introducing the log](/blog/introducing-the-log)—corpus audit fixtures used in the Action self-test
- [GitHub Actions · Creating a composite action](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
- [GitHub Actions · Security guides for actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [satus on GitHub](https://github.com/passkeybridge/satus)
