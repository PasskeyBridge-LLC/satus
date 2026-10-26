---
slug: v0-3-3-release-notes
title: "v0.3.3: the GitHub Action, and opt-in failure fingerprints"
description: satus 0.3.3 ships a composite GitHub Action that wraps the CLI for PR-preview databases, plus opt-in schema-shape fingerprints for the v0.4.0 eval set.
date: 2026-07-15
author: satus.sh
tags: [release, ci, github, telemetry]
draft: false
---

> **Editor's note (2026-08-05):** This post references `passkeybridge/satus-action@v1` on the GitHub Marketplace. The Action was never published as a standalone Marketplace repo; it lives in the main repo and is referenced as `passkeybridge/satus/packages/action@main`. YAML snippets below have been updated to the working reference.
`@passkeybridge/satus@0.3.3` is on npm, and `passkeybridge/satus/packages/action@main` is on the GitHub Marketplace. Two changes, both scoped: a composite Action that lets you drop `satus generate` into a PR-preview workflow with about ten lines of YAML, and an opt-in telemetry field that records an anonymised fingerprint of the schemas the CLI failed on. Neither changes what the CLI does when you run it locally. If v0.3.2 works for you today, v0.3.3 works the same way.

This post supersedes the [v0.3.3 roadmap post](/blog/v0-3-3-github-action) from 2026-07-03. The design is unchanged; a few dates and numbers are updated for reality.

## The Action

The full reference lives at [`/docs/github-action`](/docs/github-action). The example workflow is the one we've been circulating for the last two weeks:

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

Three choices in that block are load-bearing and deliberate. They read the same way in the roadmap post, and they read the same way in the docs, because none of them are things you want to discover after a compromised release tag or a silently-empty preview database.

1. **`database-url` is an input, not an env var.** GitHub redacts inputs in logs the same way it redacts env vars. Making it an input means it appears in the Marketplace UI as a required field, so a caller cannot leave it empty by accident. That is the entire justification; there is no clever plumbing underneath.
2. **`max-cost` is a string.** YAML parses `0.5` as a float, and the CLI's zod validator expects a string for `--max-cost` so it can normalise the format itself. The Action forwards it verbatim. Quote it in your workflow.
3. **The provider key stays in `env:`, not `with:`.** The Action never touches your OpenAI or Anthropic key; the CLI reads it directly from the environment, [as it has since v0.3.0](/blog/v0-3-0-anthropic-and-machine-readable-output). That keeps the key off the Action's public input schema and out of anything a compromised Action version could exfiltrate through inputs.

The Action is a [composite action](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action), not a Docker container. Three shell steps: install Node 20, run `npx --yes @passkeybridge/satus@0.3.3 generate --json`, upload the JSON manifest as a workflow artifact. That is the whole implementation. If a run works on your laptop it works here, with the same flags and the same exit codes.

## Telemetry hooks: what we collect and what we don't

The other change in v0.3.3 is a new opt-in field in the CLI's run telemetry: an anonymised fingerprint of the target schema's *shape*, plus the name of the first validator rule that failed on a dry-run. The point is to build an evaluation fixture set for the [v0.4.0 agent](/blog/agent-mode-postponed): a corpus of real failure modes we can regression-test prompt changes against, without ever needing to know which schema was which.

**What we collect, when the knob is on:**

- `schema_fingerprint`: a 64-character lowercase hex SHA-256 of the normalised schema. Normalisation sorts tables and columns, drops actual identifiers, and preserves the set of column types and foreign-key edges. Two structurally identical schemas produce the same hash regardless of naming, ordering, or casing. See [`packages/cli/src/generate/fingerprint.ts`](https://github.com/passkeybridge/satus/blob/main/packages/cli/src/generate/fingerprint.ts).
- `validator_class`: the name of the first `error`-severity finding on a dry-run failure (e.g. `fk_missing_parent`, `unique_duplicate`). Bounded to 64 characters at the ingest.
- `invocation_sequence`: the subcommand and flag *names* from the CLI invocation, never flag values. Example: `["generate", "--dry-run", "--rows"]`. Bounded to 16 entries.

**What we never collect, whether the knob is on or off:**

- Row contents. Ever. The CLI has no code path that reads generated rows into the telemetry payload.
- DDL text, table names, column names, enum labels, check-constraint expressions, or default expressions.
- Your database URL, provider key, or any environment variable.

**How to opt in:**

Run `satus init` and answer `y` at the new prompt, or add the following block to `satus.config.json` by hand:

```json
{
  "telemetry": {
    "share_failure_fingerprints": true
  }
}
```

The default is `false`. Existing configs keep working; the new field is optional at every layer (config, CLI, ingest zod).

## Not in this release

Repeating the list from the [roadmap post](/blog/v0-3-3-github-action) because the boundary is worth being public about.

- **No hosted-key mode.** BYO OpenAI or Anthropic key, in CI and on your laptop. A managed-key tier is v0.5.0 in the [renumbered roadmap](/blog/agent-mode-postponed).
- **No auto-commit of generated data.** Seed data belongs in the ephemeral preview database, not in git history.
- **No cache of previously-generated rows.** Every invocation regenerates. The correctness problem for a cache key (schema hash + profile hash + provider version) is not worth solving for a first release.
- **No matrix examples over multiple providers.** The docs show one OpenAI and one Anthropic example. The CLI has always let you set `--provider` per invocation; that predates the Action.
- **No GitLab CI, no CircleCI, no Buildkite variant.** The CLI runs anywhere Node runs. This Action is a convenience layer for the single largest CI host, not a portability layer.

The rest of the [agent-mode roadmap](/blog/agent-mode-postponed) still stands, with the numbers shifted by one minor version. What was v0.5 (`satus agent`) is now v0.4.0 and still targeted at late September 2026 after the 90-day telemetry-evidence window. What was v0.6 (hosted keys) is now v0.5.0. The renumber is the only substantive change to the previously-published plan.

## What's next

`satus agent` is the next release ([v0.4.0](/blog/agent-mode-postponed)). The evidence window for it starts now: the fingerprint field lands in the CLI today, and the eval-set summary statistics will be published in a follow-up post once we have three-figure sample counts across at least ten distinct schema shapes. If you run satus in a workflow where dry-runs occasionally fail on an unfamiliar schema, the opt-in knob above is where that evidence comes from.

## References

- [GitHub Action reference](/docs/github-action) — canonical inputs, outputs, and security notes
- [v0.3.3 roadmap](/blog/v0-3-3-github-action) — original design record (superseded by this post)
- [Agent mode, postponed to v0.5](/blog/agent-mode-postponed) — the v0.4.0 plan the fingerprint field is built for
- [v0.3.0 release notes](/blog/v0-3-0-anthropic-and-machine-readable-output) — provider auto-detect and env-var conventions the Action inherits
- [Introducing the log](/blog/introducing-the-log) — corpus audit fixtures used in the Action self-test
- [`@passkeybridge/satus` on npm](https://www.npmjs.com/package/@passkeybridge/satus)
- [GitHub Actions: composite action docs](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
- [GitHub Actions: security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [satus on GitHub](https://github.com/passkeybridge/satus)
