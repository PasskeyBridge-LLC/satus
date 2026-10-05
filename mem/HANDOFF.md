# HANDOFF

Written 2026-10-05 after the weekly E2E. Replace this file next session; do not append.

## State

Production is `0afb8df00467eb1b0353dc5abd80a37e28f212b9`, deployment
`dpl_AFSzMiQwQPTgNM1ieC5wqNWv2eBM`, target production, READY. That SHA is
`origin/main`. The 07-17 pg_dump correction is in it (`42ed098`). CLI is
0.3.11. npm `latest` was not moved. `next` is still `0.3.11-orgmove.0`
and has no tag.

The ledger is `mem/weekly-e2e/2026-10-05.md`. NEW 1 / FIXED 0 / STILL-OPEN 5 /
REGRESSED 0. `/recipes` fails axe contrast (4.42:1) and one scrollable `pre`.
Fix `81cedf6` is on `origin/cursor/recipes-axe-contrast-b38b`. The first push
returned HTTP 401; a retry succeeded. It is not in production until that
branch is on `main` and a deployment for the squash SHA is READY.

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

1. Squash-merge `cursor/recipes-axe-contrast-b38b`, confirm a production
   deployment for that SHA, and re-run axe on `/recipes`.
2. Confirm the 2026-10-09 draft post before Friday, or leave it draft.
3. Revoke the old npm token on npmjs.com (handoff of 2026-09-25).
4. Confirm the Auth leaked-password toggle. Do not infer it from the missing
   advisor warning.
