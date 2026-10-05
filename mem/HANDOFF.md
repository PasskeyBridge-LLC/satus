# HANDOFF

Written 2026-10-04. Replace this file next session; do not append.

## State

`main` and production are `18e9ce6cf3ab937ff2ddce30af7c78fa32c42e76`. Deployment
`dpl_9wQcUvepcAQrcFY6VsBUTwxmRYnT` is READY, target production.
`https://satus.sh/`, `/pricing`, and `/docs` return 200. CLI package version
is 0.3.11. npm `latest` was not moved. `next` is still `0.3.11-orgmove.0`.

The ledger is `mem/weekly-e2e/2026-10-04.md`. Shipped: ST-9 #19, ST-7 #20,
ST-1 #21, ST-5 and ST-6 #22, ST-14 #23, ST-12 and ST-13 #24, ST-4 #25,
ST-11 #26 and #27. Lighthouse 12, mobile, simulated throttling, after #27:
`/` LCP 2619 / 2417 / 2415 ms (median 2417) TBT 0; `/pricing` 2416 and 2413,
TBT 0; `/docs` 2410 and 2411, TBT 0. Before: 3773/293, 3850/283, 3772/203.

## Left open on purpose

ST-2 e2e-health has no shared secret. ST-3 verify still fails open when the
rate-limit RPC errors. ST-8 the 82 suppression rows were not deleted. ST-15
leaked-password protection was not enabled. Do not merge
`content/correct-07-17-pg-dump-claims`, `feat/xai-demo`, or
`ops/weekly-e2e-spec`. Do not move the npm dist-tag from here.

## Flags

`DO_NOT_TRACK` wins. Telemetry stays off unless configured.
`minimumReleaseAge` is 24h. Report-only Content-Security-Policy is on `/`;
there is no enforcing policy. `POST /api/public/cli/run` fails closed at 60
per hour per IP hash. Two moderate vitest mocker findings remain
(GHSA-82fw-gwwq-j7x9); the patched line is vitest ≥4.1.11. Multi-column
UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.

## Graduated this session

2026-10-04 resolutions, into the ledger. Local test database stays
`scripts/test-db.sh`.

## Next

1. Confirm the 2026-10-09 draft post before Friday, or leave it draft.
2. Revoke the old npm token on npmjs.com (handoff of 2026-09-25).
