# HANDOFF

Written 2026-11-14 after 0.3.13 merged (#87). Replace this file next session; do not append.

## State

`main` is `b47edb7` (#87). Production for that SHA is `dpl_BT5QAyqWGzGFMjHgaXu1gh4d78FQ`, READY, aliases `satus.sh` and `www.satus.sh`. Push CI on `b47edb7`: cli-ci (Node 20/22/24/26), site-ci and secret scan green.

The CLI files say 0.3.13. The site chip, the Action `satus-version` default and the Action README stay 0.3.12 until 0.3.13 is on npm (see release-and-deploy-traps.md). npm `latest` is 0.3.12, `next` is 0.3.11-orgmove.0. 0.3.13 has no tag and is not published.

OpenAI default is `gpt-6-luna`, verified live 2026-11-13 (request body and a 5-row run against throwaway pagila).

## Next

1. Joel: annotated tag `v0.3.13` on `b47edb7` from a machine with GitHub push (tag pushes get 403 from the agent sandbox). `cli-publish.yml` publishes. Confirm `npm view @passkeybridge/satus@0.3.13 dist.tarball` and the trusted publisher.
2. After npm answers: one PR moves `src/lib/version.ts` (`SATUS_VERSION`, `SATUS_RELEASED_AT` = publish date), the `action.yml` default and the Action README to 0.3.13, and dates the CHANGELOG `[0.3.13]` heading.
3. Joel (D3): `npm dist-tag add @passkeybridge/satus@0.3.13 next`.
4. Decide whether `satus generate` warns when a config-pinned model has a shutdown date (followups/openai-default-0-3-13.md).
5. PR #86 (`qa/a11y-overflow-1111`, draft, CI green) fixes two live findings: `/cli` overflows at 320 and 360 px, and axe `scrollable-region-focusable` (serious) on `/quickstart` and `/cli` at 390 px. It needs a merge decision.
6. Carried: Stripe sandbox secrets and Stripe CLI for the S1 issuance test (Joel). D4 agent mode.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP unchanged. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented limits. Do not repair hosted `schema_migrations` in passing. Branches whose PRs are merged and could be deleted (Bob): `cursor/*-b38b` (5), `qa/exit-codes-docs-1110`, `qa/llms-exit-codes-1110`, `qa/release-notes-plain-1110-staged`, `qa/relnotes-plain-1111`. PR #75 is closed unmerged.

## Graduated this session

- features/release-and-deploy-traps.md: version-group release order; no Vercel preview for `claude/*` and `cursor/*` branches.
- followups/openai-default-0-3-13.md: new.
- followups/prose-claims-have-no-automated-check.md: the generated-columns post still shows `satus plan`.
