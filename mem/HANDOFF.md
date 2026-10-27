# HANDOFF

Written 2026-10-27 after the QA-report fixes on `cursor/qa-report-satus-fixes-3691`. Replace this file next session; do not append.

## State

`main` is `da6db03` (`@passkeybridge/satus@0.3.12`, PR #69 merged). This session's branch is not merged. Joel reviews and merges. No npm publish. Dist-tags were not moved. `next` still points at `0.3.11-orgmove.0`.

Verified on `da6db03` before editing. Fixed here: C F5 (quickstart auto-detect), C F9 (three blog descriptions), C N1, C N2, D #6 (webhook probe log level). Not in this repo: C F4 (no held-post reminder), C F6 (no chat route; demo 503 is `demo_unavailable`), C F7 (no `@ai-sdk/xai`; chat completions has no `store` field), C F8 (passkeybridge copy).

## Left open on purpose

Nothing. The pricing FAQ now states the same two-key rule as the quickstart.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/` was not changed. Multi-column UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.

## Graduated this session

The previous handoff's "merge #69" item. #69 is on `main` (`da6db03`). Nothing else moved into mem/.

## Next

1. Joel reviews the QA PR and merges. Do not publish. Do not move dist-tags.
