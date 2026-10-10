# HANDOFF

Written 2026-10-05 after the weekly E2E. Replace this file next session; do not append.

## State

Production for the weekly fix is `a28a31c894a97cd1f4edc76d507fe58a9c68fd57`
(#29), deployment `dpl_7AGaEELY4C3xbPoxoBTtq72NWkTJ`, target production,
READY. `https://satus.sh/recipes` serves `#b91c1c` and `tabindex="0"`.
After this handoff commit, production must match `origin/main`. The 07-17
pg_dump correction remains in history (`42ed098`). CLI is 0.3.11. npm
`latest` was not moved. `next` is still `0.3.11-orgmove.0` and has no tag.

The ledger is `mem/weekly-e2e/2026-10-05.md`. NEW 1 / FIXED 1 / STILL-OPEN 4 /
REGRESSED 0. The recipes axe finding is fixed.

## Left open on purpose

ST-2 e2e-health has no shared secret. ST-3 verify still fails open when the
rate-limit RPC errors. ST-8 the 82 suppression rows were not deleted. ST-15
the leaked-password advisor WARN is absent from this week's payload; the Auth
setting was not read and was not changed. Do not merge `feat/xai-demo` or
`ops/weekly-e2e-spec`. Do not move the npm dist-tag. The draft post
`2026-10-09-pg-dump-snapshots-as-test-fixtures` stays draft until its
`publishAt`.

## Flags

`DO_NOT_TRACK` wins. Telemetry stays off unless configured.
`minimumReleaseAge` is 24h. Report-only Content-Security-Policy is on `/`.
`POST /api/public/cli/run` fails closed at 60 per hour per IP hash. Two
moderate vitest mocker findings remain (GHSA-82fw-gwwq-j7x9). Multi-column
UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.
There is still no `process-email-queue` cron. Both pgmq queues and both DLQs
were empty.

## Graduated this session

2026-10-05 weekly results are in the ledger. Live license rows match three
`satus.sh` subscriptions. Local test database stays `scripts/test-db.sh`.

## Next

1. Confirm the 2026-10-09 draft post before Friday, or leave it draft.
2. Revoke the old npm token on npmjs.com (handoff of 2026-09-25).
3. Confirm the Auth leaked-password toggle. Do not infer it from the missing
   advisor warning.
