# HANDOFF

Written 2026-11-15 at closeout of the 0.3.13 work. Replace this file next session; do not append.

## State

`main` carries 0.3.13 (#87), the shutdown warning and blog correction (#89), the inline-code and focusable code-block fixes (#86), the home-page 320 px fix (#91) and the home-page step copy fix (the PR that carries this file). Last verified deploy before this PR: `dpl_9McgAUan3wCEbT8yjmp7TZPFLGac` for `5a0487d`, READY. On production: no horizontal overflow at 320–390 px on `/`, `/cli`, `/quickstart`, `/recipes`, `/docs/github-action`; axe-core 4.11.0 WCAG 2.2 A/AA reports 0 serious or critical on those pages at 390 and 1440 px.

The CLI files say 0.3.13. The site chip, the Action `satus-version` default and the Action README stay 0.3.12 until 0.3.13 is on npm (release-and-deploy-traps.md). npm `latest` is 0.3.12, `next` is 0.3.11-orgmove.0. No `v0.3.13` tag: the agent's tag push was refused by the session's permission check.

## Next

1. Joel: `git tag -a v0.3.13 -m "v0.3.13" 3f647b0 && git push origin v0.3.13` from a machine with GitHub push. `3f647b0` is the first commit with the full 0.3.13 CLI; later commits change only the site and `mem/`. Confirm `npm view @passkeybridge/satus@0.3.13 dist.tarball` and `_npmUser.trustedPublisher`.
2. After npm answers: one PR moves `src/lib/version.ts` (`SATUS_VERSION`, `SATUS_RELEASED_AT` = publish date), the `action.yml` default and the Action README to 0.3.13, and dates the CHANGELOG `[0.3.13]` heading.
3. Joel (D3): `npm dist-tag add @passkeybridge/satus@0.3.13 next`.
4. Carried: Stripe sandbox secrets and Stripe CLI for the S1 issuance test (Joel). D4 agent mode. Roadmap item 1 (model and price freshness check in CI).

## Flags

`DO_NOT_TRACK` wins. Report-only CSP unchanged. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented limits. Do not repair hosted `schema_migrations` in passing. Branches whose PRs are merged and could be deleted (Bob): `cursor/*-b38b` (5), `qa/exit-codes-docs-1110`, `qa/llms-exit-codes-1110`, `qa/release-notes-plain-1110-staged`, `qa/relnotes-plain-1111`, `qa/a11y-overflow-1111`. PR #75 is closed unmerged.

## Graduated this session

- followups/prose-claims-have-no-automated-check.md: home-page step claims marked fixed.
