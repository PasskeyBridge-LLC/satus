# HANDOFF

Written 2026-10-26 after the 0.3.12 wording fix on PR #69. Replace this file next session; do not append.

## State

`@passkeybridge/satus@0.3.12` is npm `latest` (published 2026-10-26, gitHead `f4f33a453a9d4c5941596c81acdea31e0ae74c97`). PR #69 (`cursor/action-published-version-0-3-12-0a56`) sets the validate-docs published group to `0.3.12`: Action `satus-version` default, Action README table, `src/lib/version.ts` `SATUS_VERSION`. `SATUS_RELEASED_AT` is `2026-10-26`.

`packages/cli/README.md` opens on `v0.3.12` and says the `xai` provider is included. Live pages name `0.3.12` for xAI. Historical changelog entries and blog posts about past releases were left as written.

Not merged. Dist-tags were not moved. Nothing was published.

## Left open on purpose

`next` still points at `0.3.11-orgmove.0`. It was not moved.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/`. Multi-column UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.

## Graduated this session

Nothing.

## Next

1. Merge #69 when its CI is green. Do not publish. Do not move dist-tags.
