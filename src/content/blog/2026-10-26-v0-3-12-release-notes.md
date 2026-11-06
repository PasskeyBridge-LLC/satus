---
slug: v0-3-12-release-notes
title: "v0.3.12: xAI provider, schema USAGE skip, zod 4.6.6"
description: satus 0.3.12 adds an xAI provider, skips tables when a role lacks schema USAGE, and depends on zod 4.6.6. The Action pin landed the same day, after the tag.
date: 2026-10-26
publishAt: 2026-10-26T12:00:00-04:00
author: satus.sh
tags: [release, cli, postgres]
draft: false
---

`@passkeybridge/satus@0.3.12` was published to npm on 2026-10-26 at 11:26:29 EDT. The git tag `v0.3.12` is `f4f33a453a9d4c5941596c81acdea31e0ae74c97`, parent of the site-dependency commit that closed the tag. `v0.3.11` is `8e17aa95d3199dd3d08a8ef51142f631a5079c35`. The installed binary reports:

```
$ satus --version
0.3.12
```

The published tarball depends on `commander`, `pg`, `zod` `^4.6.6`, and `picocolors`.

The range `v0.3.11..v0.3.12` contains 117 commits. Most of them are the site, docs, and CI. The CLI behavior changes in that range are the xAI provider, the schema `USAGE` check, the version and `zod` bump, and a comment on which foreign-key cycles exit 10. One more commit on `main` the same afternoon pins the GitHub Action. It is not inside the tag.

## xAI provider

[`ff9808a`](https://github.com/PasskeyBridge-LLC/satus/commit/ff9808afe52bb6829a90f92e97ba98830f64dab1) (pull request 9, 2026-09-26) adds `--provider xai`. The help text from this binary:

```
  --provider <id>   LLM provider (openai | anthropic | xai); auto-detected from
                    env when omitted
```

An unknown provider name exits 1:

```
$ satus generate --dry-run --rows 25 --provider gemini
Unknown --provider: gemini. Use openai | anthropic | xai.
```

The default model string in the 0.3.12 bundle is `grok-4.20-0309-non-reasoning`. `XAI_API_KEY` is selected automatically only when neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is set. `--provider xai` selects it directly. `XAI_BASE_URL` overrides the endpoint. The changelog records that reasoning tokens are counted as output, because xAI bills them.

## Schema USAGE

[`56cc461`](https://github.com/PasskeyBridge-LLC/satus/commit/56cc4610a334415b335dfce45e6dc31747ba32c9) (pull request 60, 2026-10-20) changes `countUserRows`. The readable flag is `has_schema_privilege(n.oid, 'USAGE')` and `has_table_privilege(c.oid, 'SELECT')`. The previous code resolved a schema-qualified name, and a role without `USAGE` on that schema failed the guard instead of skipping the table. The [row-count post](/blog/how-satus-decides-a-database-is-too-full-to-seed) runs the 0.3.12 behavior: `seeder` with no `USAGE` on `audit` skips `audit.events` and the dry run continues.

## Nullable cycles, in the comment

[`70314a7`](https://github.com/PasskeyBridge-LLC/satus/commit/70314a7d5abbfbb04773622442915a8114e0e2e4) (pull request 59, 2026-10-20) updates the exit-code comment and the docs. A cycle exits 10 when no foreign key on the cycle is nullable. A column default or a `DEFERRABLE` constraint does not break it. That was already the 0.3.11 behavior. The commit is the wording change.

## zod 4.6.6

[`631e5b1`](https://github.com/PasskeyBridge-LLC/satus/commit/631e5b1fc95ef111f3ce6c80226ef190458b4af4) (pull request 67, 2026-10-26) sets the package version to 0.3.12 and the `zod` dependency to `^4.6.6`. The changelog names GHSA-mrhx-c7xc-m3w5 for `zod` versions before 4.6.6.

The tag itself, [`f4f33a4`](https://github.com/PasskeyBridge-LLC/satus/commit/f4f33a453a9d4c5941596c81acdea31e0ae74c97) (pull request 68), updates site dependencies. It does not change the CLI source beyond what pull request 67 already set.

## Action pin, after the tag

At tag `v0.3.12`, `packages/action/action.yml` still defaulted `satus-version` to `0.3.11`. [`da6db03`](https://github.com/PasskeyBridge-LLC/satus/commit/da6db03c39467c44672ff005487d441277a690b0) (pull request 69, 2026-10-26 11:41 EDT) sets that default to `0.3.12`. The commit is on `main` and is not an ancestor of the tag. `src/lib/version.ts` in that commit sets `SATUS_VERSION` to `0.3.12` and `SATUS_RELEASED_AT` to `2026-10-26`.

## Upgrading

```bash
npm install -g @passkeybridge/satus@0.3.12
```

No config migration. A `satus.config.json` from 0.3.11 still loads. `provider` may now be `xai`.

Source-visible and commercially licensed. Not open source. See `LICENSE`.
