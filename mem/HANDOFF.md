# HANDOFF

Written 2026-11-14 after #86 and the home-page overflow fix. Replace this file next session; do not append.

## State

`main` is `76521a4` (#86) plus the PR that carries this file (home-page overflow at 320 px). #86 deployed as `dpl_81K46Tz6UmKV7gh3LBd1gCHvDSP1`, READY; push CI green. On production after #86: `/cli`, `/quickstart`, `/recipes` and `/docs/github-action` have no horizontal overflow at 320–390 px and axe-core 4.11.0 (WCAG 2.2 A/AA) reports 0 serious or critical at 390 and 1440 px.

The CLI files say 0.3.13 and include the shutdown warning (#89). The site chip, the Action `satus-version` default and the Action README stay 0.3.12 until 0.3.13 is on npm (release-and-deploy-traps.md). npm `latest` is 0.3.12, `next` is 0.3.11-orgmove.0. There is no `v0.3.13` tag: the agent's tag push was refused by the session's permission check.

## Next

1. Joel: `git tag -a v0.3.13 -m "v0.3.13" 3f647b0 && git push origin v0.3.13` from a machine with GitHub push (`3f647b0` is the first commit with the full 0.3.13 CLI; later commits change only the site and `mem/`). `cli-publish.yml` publishes. Confirm `npm view @passkeybridge/satus@0.3.13 dist.tarball` and `_npmUser.trustedPublisher`.
2. After npm answers: one PR moves `src/lib/version.ts` (`SATUS_VERSION`, `SATUS_RELEASED_AT` = publish date), the `action.yml` default and the Action README to 0.3.13, and dates the CHANGELOG `[0.3.13]` heading.
3. Joel (D3): `npm dist-tag add @passkeybridge/satus@0.3.13 next`.
4. Copy: the home-page "How it works" steps claim CHECK and enum introspection and a zod validator (followups/prose-claims-have-no-automated-check.md).
5. Carried: Stripe sandbox secrets and Stripe CLI for the S1 issuance test (Joel). D4 agent mode.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP unchanged. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented limits. Do not repair hosted `schema_migrations` in passing. Branches whose PRs are merged and could be deleted (Bob): `cursor/*-b38b` (5), `qa/exit-codes-docs-1110`, `qa/llms-exit-codes-1110`, `qa/release-notes-plain-1110-staged`, `qa/relnotes-plain-1111`, `qa/a11y-overflow-1111`. PR #75 is closed unmerged.

## Graduated this session

- followups/prose-claims-have-no-automated-check.md: home-page step claims (new).
