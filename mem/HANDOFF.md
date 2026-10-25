# HANDOFF

Written 2026-10-25 after the archive-migration check. Replace this file next session; do not append.

## State

Before these merges, `main` was `7e3a02e`. Production `dpl_G6tosDg468DmmwZMyoFa87Brwtsa` is READY, target production, that SHA.

Project `xbnrjwzryuonuinzuomk` has the three 2026-10-19 migrations applied: `20261019091540` `archive_satus_demo`, `20261019091551` `wrap_auth_rls_initplan`, `20261019091555` `drop_unused_email_send_log_recipient_index`. The ledger has 11 rows. `satus_demo` and `archive_satus_demo` are absent. Postgres logged `DROP SCHEMA archive_satus_demo CASCADE` at 2026-10-19T10:01:25.473Z (`POST /mcp`). The applied migration only comments that DROP. No ledger row records it. PR #50 said the DROP was still waiting. That was false from 10:01 UTC on 2026-10-19.

Thirteen public service-role policies use `(SELECT auth.role())`. `idx_email_send_log_recipient` is absent. `rate_limit_counters` has RLS on and no policy. The security advisor at 2026-10-25T21:02:52Z lists that one INFO lint.

#54 `d17d662` records the 2026-10-19 weekly ledger and corrects the DROP line. Twenty-five files under `supabase/migrations/` have no ledger row. Do not `db push`.

Thirty-four remote branches were deleted after each tip was either an ancestor of `main` or the exact head of a PR whose squash commit is on `main`. None had a later unmerged commit.

## Left open on purpose

The Auth connection cap was not re-read. Suppression rows were not re-counted. Stripe keys, the old npm token, and `next` at `0.3.11-orgmove.0` stay with Joel. `cli-publish.yml` was not changed. The mail drain is the Vercel Cron in `vercel.json`.

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/`. Multi-column UNIQUE, cross-column arithmetic, and `--seed` stay documented CLI limits.

## Graduated this session

The archive note is in `mem/followups/satus-supabase-advisor-deferred.md`.

## Next

1. Joel: keep or retire `cli-publish.yml`. The last run is failure [36333516038](https://github.com/PasskeyBridge-LLC/satus/actions/runs/36333516038) (2026-09-27), step "Report publish auth path". Publish succeeded. No other workflow calls this file. The Action and the site install `@passkeybridge/satus` from npm.
2. Revoke the old npm token (Joel).
3. Confirm the Auth leaked-password toggle (Joel). It was not read.
