# HANDOFF

Written 2026-11-14 after #89 merged. Replace this file next session; do not append.

## State

`main` is `3f647b0` (#89). Production for that SHA is `dpl_4pVQ212ax5Aa6YCFQ9ETSiWijTdo`, READY, aliases `satus.sh` and `www.satus.sh`. Push CI on `3f647b0`: cli-ci (Node 20/22/24/26), site-ci and secret scan green. Earlier today: 0.3.13 in #87 (`b47edb7`), notes in #88 (`e037a1e`).

The CLI files say 0.3.13 and include the #89 shutdown warning. The site chip, the Action `satus-version` default and the Action README stay 0.3.12 until 0.3.13 is on npm (release-and-deploy-traps.md). npm `latest` is 0.3.12, `next` is 0.3.11-orgmove.0. There is no `v0.3.13` tag: the agent's tag push was refused by the session's permission check, so publishing stays with Joel.

## Next

1. Joel: `git tag -a v0.3.13 -m "v0.3.13" 3f647b0 && git push origin v0.3.13` from a machine with GitHub push. `cli-publish.yml` publishes. Confirm `npm view @passkeybridge/satus@0.3.13 dist.tarball` and `_npmUser.trustedPublisher`.
2. After npm answers: one PR moves `src/lib/version.ts` (`SATUS_VERSION`, `SATUS_RELEASED_AT` = publish date), the `action.yml` default and the Action README to 0.3.13, and dates the CHANGELOG `[0.3.13]` heading.
3. Joel (D3): `npm dist-tag add @passkeybridge/satus@0.3.13 next`.
4. PR #86 (`qa/a11y-overflow-1111`, draft, CI green) fixes two live findings: `/cli` overflows at 320 and 360 px, and axe `scrollable-region-focusable` (serious) on `/quickstart` and `/cli` at 390 px. It needs a merge decision.
5. Carried: Stripe sandbox secrets and Stripe CLI for the S1 issuance test (Joel). D4 agent mode.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP unchanged. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented limits. Do not repair hosted `schema_migrations` in passing. Branches whose PRs are merged and could be deleted (Bob): `cursor/*-b38b` (5), `qa/exit-codes-docs-1110`, `qa/llms-exit-codes-1110`, `qa/release-notes-plain-1110-staged`, `qa/relnotes-plain-1111`. PR #75 is closed unmerged.

## Graduated this session

- followups/openai-default-0-3-13.md: item 1 (config-pinned model warning) done in #89.
- followups/prose-claims-have-no-automated-check.md: generated-columns post corrected in #89.
