---
slug: v0-3-5-release-notes
title: "v0.3.5: automated npm publishing, two correctness fixes"
description: satus 0.3.5 adds tag-triggered npm publishing with provenance, restores deferrable-FK detection, and makes the Action selftest use the in-repo CLI.
date: 2026-07-16
author: satus.sh
tags: [release, ci, github, npm]
draft: false
---

`@passkeybridge/satus@0.3.5` is on npm. Three changes: a new publish pipeline, one correctness fix in the introspection reader, and one CI fix in the Action selftest. No CLI flags, config, or telemetry-schema changes. If v0.3.4 worked for you, v0.3.5 works the same way from the outside.

The release itself is the first one cut by the new tag-triggered workflow.

## Automated publishing

Pushing a `v*.*.*` tag on `main` now triggers a GitHub Actions workflow that builds and publishes the CLI to npm. The workflow lives at [`.github/workflows/cli-publish.yml`](https://github.com/passkeybridge/satus/blob/main/.github/workflows/cli-publish.yml) and does four things worth naming:

1. **Verifies the tag matches `packages/cli/package.json`.** If the tag and the package version disagree, the guard step fails before anything reaches npm.
2. **Runs `npm ci` and `npm run build`** in `packages/cli/`. The package's `prepublishOnly` also runs `tsc --noEmit`, so a type error blocks publish regardless of what the tag says.
3. **Publishes with `--provenance`.** The workflow requests `id-token: write` and passes `--provenance` to `npm publish`, which attaches a signed [npm provenance statement](https://docs.npmjs.com/generating-provenance-statements) linking the tarball to the exact Actions run and source commit. Consumers can verify the chain with `npm audit signatures`.
4. **Uses a scoped `NPM_PUBLISH_TOKEN` secret** with publish rights limited to `@passkeybridge/satus`. `workflow_dispatch` with `dry_run: true` exercises the pipeline without cutting a release.

Nothing about installing or running the CLI changes. `npm i -g @passkeybridge/satus` still works the same way; the tarball on npm is now produced by a reproducible pipeline on tag push.

## Fix: deferrable FK detection in the introspection reader

The single-CTE catalog introspection query (introduced in [v0.2.0](/blog/v0-2-0-deferred-constraints-faster-planning-smaller-binary)) aliases its foreign-key deferrability columns as `is_deferrable` and `is_initially_deferred`, matching `information_schema` naming. The TypeScript reader was reading `deferrable` and `initially_deferred` off each row, so both fields resolved to `undefined` and every FK was recorded as non-deferrable regardless of its actual schema.

Practical impact: the cyclic-FK path shipped in v0.2.0, which depends on knowing which constraints are `DEFERRABLE INITIALLY DEFERRED`, could quietly fall back to non-deferred handling on schemas that actually had the right constraints in place. The fix aligns the reader with the query's own aliases. No config or CLI change is required; re-running `satus generate` picks up the corrected metadata.

## Fix: Action selftest validates the in-repo CLI

[`.github/workflows/action-selftest.yml`](https://github.com/passkeybridge/satus/blob/main/.github/workflows/action-selftest.yml) loads the [pagila](https://github.com/devrimgunduz/pagila) schema and runs the composite Action end-to-end on every push under `packages/action/`. The Action itself invokes the CLI with `npx --yes @passkeybridge/satus@<pinned>`, which pulled whatever was on npm rather than the code in the tree. On a version bump, the selftest could pass against the previously published CLI while the in-repo code was broken.

v0.3.5 changes this so the selftest is meaningful:

- The workflow now runs `npm ci && npm run build && npm pack && npm install -g` inside `packages/cli/` before invoking the action, so a `satus` binary built from the current tree is on `PATH`.
- The composite Action prefers a `satus` binary already on `PATH` and falls back to the pinned `npx` install for normal consumers. Real users see no behavior change; the selftest now validates the code that's actually about to ship.

The default `satus-version` in [`packages/action/action.yml`](https://github.com/passkeybridge/satus/blob/main/packages/action/action.yml) is bumped from `0.3.4` to `0.3.5` in the same release.

## Backward compatibility

No CLI flags added, removed, or renamed. No telemetry-schema changes. No changes to `satus.config.json` semantics. Configs that worked with v0.3.x continue to work unchanged.

## References

- [`@passkeybridge/satus` on npm](https://www.npmjs.com/package/@passkeybridge/satus)
- [`cli-publish.yml` workflow source](https://github.com/passkeybridge/satus/blob/main/.github/workflows/cli-publish.yml)
- [`action-selftest.yml` workflow source](https://github.com/passkeybridge/satus/blob/main/.github/workflows/action-selftest.yml)
- [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements)
- [v0.3.3 release notes](/blog/v0-3-3-release-notes) — the GitHub Action and opt-in failure fingerprints
- [v0.2.0 release notes](/blog/v0-2-0-deferred-constraints-faster-planning-smaller-binary) — original single-CTE introspection and deferrable-constraint handling
- [satus on GitHub](https://github.com/passkeybridge/satus)
