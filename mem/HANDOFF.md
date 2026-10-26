# HANDOFF

Written 2026-10-26 after the 0.3.12 published-version pin. Replace this file next session; do not append.

## State

`@passkeybridge/satus@0.3.12` is npm `latest` (published 2026-10-26, gitHead `f4f33a453a9d4c5941596c81acdea31e0ae74c97`). PR #69 (`cursor/action-published-version-0-3-12-0a56`) sets the validate-docs published group to `0.3.12`: `packages/action/action.yml` default, `packages/action/README.md` table, `src/lib/version.ts` `SATUS_VERSION`. `SATUS_RELEASED_AT` is `2026-10-26`. `packages/action` has no `src/` and no committed dist.

Not merged. Dist-tags were not moved. Nothing was published.

`git branch -r --no-merged origin/main` lists this branch.

## Left open on purpose

`packages/cli/README.md` still opens on `v0.3.11` and says the `xai` provider ships in the next release. Other pages still say "from the CLI release after 0.3.11". Those lines are outside the published-version group. `next` was not touched.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/`. Multi-column UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.

## Graduated this session

Nothing.

## Next

1. Merge #69 when its CI is green. Do not publish. Do not move dist-tags.
