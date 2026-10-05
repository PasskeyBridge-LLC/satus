# HANDOFF

Written 2026-10-05. Replace this file next session; do not append.

## State

The 07-17 pg_dump correction is `42ed0982e603a85e163d5bf02111fd19b1ed27d1`
(#5). Production deployment `dpl_E3HqCt9aYEbmajzTCSt7BUWyYoud` was READY for
that SHA before this handoff commit. After this commit, production must
match `origin/main`. `https://satus.sh/`, `/pricing`, `/docs`, and
`/blog/what-pg-dump-doesnt-tell-you` returned 200, and the post carried the
2026-10-05 correction. CLI package version is 0.3.11. npm `latest` was not
moved. `next` is still `0.3.11-orgmove.0`.

The ledger is `mem/weekly-e2e/2026-10-04.md`. Shipped earlier: ST-9 #19,
ST-7 #20, ST-1 #21, ST-5 and ST-6 #22, ST-14 #23, ST-12 and ST-13 #24,
ST-4 #25, ST-11 #26 and #27. Lighthouse 12, mobile, simulated throttling,
after #27: `/` LCP median 2417 ms TBT 0; `/pricing` about 2414 TBT 0;
`/docs` about 2410 TBT 0.

## Left open on purpose

ST-2 e2e-health has no shared secret. ST-3 verify still fails open when the
rate-limit RPC errors. ST-8 the 82 suppression rows were not deleted. ST-15
leaked-password protection was not enabled. Do not merge `feat/xai-demo` or
`ops/weekly-e2e-spec`. Do not move the npm dist-tag from here. The draft
post `2026-10-09-pg-dump-snapshots-as-test-fixtures` stays draft until its
`publishAt`.

## Flags

`DO_NOT_TRACK` wins. Telemetry stays off unless configured.
`minimumReleaseAge` is 24h. Report-only Content-Security-Policy is on `/`;
there is no enforcing policy. `POST /api/public/cli/run` fails closed at 60
per hour per IP hash. Two moderate vitest mocker findings remain
(GHSA-82fw-gwwq-j7x9); the patched line is vitest ≥4.1.11. Multi-column
UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.

## Graduated this session

The 07-17 pg_dump correction is live. 2026-10-04 resolutions stay in the
ledger. Local test database stays `scripts/test-db.sh`.

## Next

1. Confirm the 2026-10-09 draft post before Friday, or leave it draft.
2. Revoke the old npm token on npmjs.com (handoff of 2026-09-25).
