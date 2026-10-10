# HANDOFF

Written 2026-10-10 after Joel's open-items batch. Replace this file next session; do not append.

## State

`main` is `041af82` or later; every merge below deployed to production READY.

- #40 `1f080a7`: `/api/public/hooks/e2e-health` requires `x-e2e-health-secret` (`E2E_HEALTH_SECRET`, Vercel production + preview, sensitive; same-name GitHub Actions secret). Constant-time compare before any work: 401 missing or wrong, 503 unset. Daily caller is `.github/workflows/e2e-health.yml` (06:00 UTC). pg_cron `satus-e2e-health-daily` was unscheduled; the migration in this PR records that. Verified: 401 without/with wrong secret, 200 `pass` with it, and from the workflow.
- #41 `445eae7`: license verify stays fail-open on counter errors; counter and lookup failures raise Sentry warnings, fingerprint `["license-verify", <kind>]`, error code only.
- #42 `2eda6eb`: CLI vitest 4.1.11 (78 tests green on Node 20 and 24). GHSA-82fw-gwwq-j7x9 cleared.
- #43 `041af82`: `docs/weekly-e2e/satus-weekly-e2e.md` merged. Its 2026-10-04 facts about pg_cron and an unauthenticated e2e-health are now stale.
- `feat/xai-demo` deleted (identical to #8). `content/correct-07-17-pg-dump-claims` was already gone (#5).

## Left open on purpose

ST-8: the 82 suppression rows stay (count re-read 2026-10-10). Stripe keys need Joel. npm `next` stays `0.3.11-orgmove.0`. Revoking the old npm token is Joel's. The mail drain is the Vercel Cron in `vercel.json` (every minute, `CRON_SECRET`); no pg_cron `process-email-queue` is needed. Queues were empty.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/`. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented CLI limits.

## Graduated this session

Nothing new under `mem/`; the e2e-health contract is in the route header and AGENTS.md.

## Next

1. Revoke the old npm token on npmjs.com (Joel).
2. Confirm the Auth leaked-password toggle (Joel).
3. Refresh the weekly E2E spec where it describes e2e-health and pg_cron.
