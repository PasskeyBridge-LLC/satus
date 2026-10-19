# HANDOFF

Written 2026-10-19 after the satus Supabase advisor ship. Replace this file next session; do not append.

## State

`main` is `1ee06cf` (PR #49, squash). Production deployment `dpl_HiLZbo178ZfcaJiSgYabMczKQtFv` is READY with `target: production`.

Applied once to project `xbnrjwzryuonuinzuomk` through `apply_migration`, not `db push`:

- `20261019091540` `archive_satus_demo`
- `20261019091551` `wrap_auth_rls_initplan`
- `20261019091555` `drop_unused_email_send_log_recipient_index`

`satus_demo` is gone. `archive_satus_demo.users`, `projects`, and `tasks` have RLS on and no policies. Schema, table, and default ACLs have zero grants for PUBLIC, anon, authenticated, and service_role; only `postgres` remains. The 13 service-role policies use `(SELECT auth.role())`. `idx_email_send_log_recipient` is gone. Nothing was dropped.

Hosted `schema_migrations` is still the 2026-08-05 baseline plus these three. Do not repair that history and do not `db push`.

## Left open on purpose

`DROP SCHEMA archive_satus_demo CASCADE` waits for Joel. `rate_limit_counters` stays RLS-on with no policy. Auth stays at an absolute cap of 10 connections. ST-8: the 82 suppression rows stay. Stripe keys need Joel. npm `next` stays `0.3.11-orgmove.0`. Revoking the old npm token is Joel's. The mail drain is the Vercel Cron in `vercel.json` (every minute, `CRON_SECRET`).

## Flags

`DO_NOT_TRACK` wins. Report-only CSP on `/`. Multi-column UNIQUE, cross-column arithmetic and `--seed` stay documented CLI limits.

## Graduated this session

SAT-1 and the applied SAT-2 notes moved to `mem/followups/satus-supabase-advisor-deferred.md`.

## Next

1. Joel: approve or reject `DROP SCHEMA archive_satus_demo CASCADE`.
2. Revoke the old npm token on npmjs.com (Joel).
3. Confirm the Auth leaked-password toggle (Joel).
4. Refresh the weekly E2E spec where it describes e2e-health and pg_cron.
