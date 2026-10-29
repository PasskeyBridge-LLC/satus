# HANDOFF

Written 2026-10-29 after the dry-run cost post slug move. Replace this file next session; do not append.

## State

`main` is `edf3c48` (`@passkeybridge/satus@0.3.12`, PR #71 merged Oct 28). This session's slug move is on a PR. Joel reviews and merges. No npm publish. Dist-tags were not moved. `next` still points at `0.3.11-orgmove.0`.

The 2026-09-11 post slug is `how-the-dry-run-cost-estimate-is-calculated`. `vercel.json` 301s `/blog/cost-estimates-are-guardrails-not-accounting` to that path, same shape as the soft-deletes redirect (`statusCode: 301`). Title and body from #71 are unchanged. CSP was not changed.

## Left open on purpose

Nothing.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/` was not changed. Multi-column UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.

## Graduated this session

The previous handoff's note that slug `cost-estimates-are-guardrails-not-accounting` was left in place after #71 changed only the title. Nothing else moved into mem/.

## Next

1. Joel reviews this slug PR and merges. Do not publish. Do not move dist-tags.
