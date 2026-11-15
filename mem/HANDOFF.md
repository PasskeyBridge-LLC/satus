# HANDOFF

Written 2026-11-15 after `@passkeybridge/satus@0.3.13` was published. Replace this file next session; do not append.

## State

npm `latest` is 0.3.13, published 12:40 UTC 2026-11-15 by `cli-publish.yml` run 43714825913 from tag `v0.3.13` (annotated, on `3f647b0`). Trusted publisher `github`, SLSA provenance v1, `npm audit signatures` verified. `npm pack` of the tag gives shasum `70a4126e7cd1dd3d564d2f335e383378efc4a757`, the same as the registry. `next` is still 0.3.11-orgmove.0.

`main` carries 0.3.13 and the site fixes (#87, #89, #86, #91, #92) plus the PR that carries this file, which moves the site chip, `SATUS_RELEASED_AT` (2026-11-15), the Action `satus-version` default and the Action README to 0.3.13 and dates the CHANGELOG heading. Last verified deploy before it: `dpl_LUrSrfDW1PWGwVLmzpFvGKfhVt25` for `fb2edc5`, READY.

## Next

1. Joel (D3): `npm dist-tag add @passkeybridge/satus@0.3.13 next` (npm session or a token with publish rights).
2. Content bot: 0.3.13 release notes on the blog. Include the config-pinned `gpt-4o-mini` line: those runs keep the old model until `model` in satus.config.json changes.
3. Roadmap item 1: model and price freshness check in CI (`providers/deprecations.ts` is maintained by hand).
4. Carried: Stripe sandbox secrets and Stripe CLI for the S1 issuance test (Joel). D4 agent mode.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP unchanged. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented limits. Do not repair hosted `schema_migrations` in passing. Branches whose PRs are merged and could be deleted (Bob): `cursor/*-b38b` (5), `qa/exit-codes-docs-1110`, `qa/llms-exit-codes-1110`, `qa/release-notes-plain-1110-staged`, `qa/relnotes-plain-1111`, `qa/a11y-overflow-1111`. PR #75 is closed unmerged.

## Graduated this session

- features/release-and-deploy-traps.md: 0.3.13 release record; tag pushes come from a machine with GitHub push, after `git fetch origin main`.
- followups/openai-default-0-3-13.md: item 1 published in 0.3.13.
