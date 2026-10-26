# Deferred satus Supabase advisor items

**Status:** open for the two items under "Still left in place". Checked
2026-10-25 against project `xbnrjwzryuonuinzuomk`.

SAT-1 and the safe SAT-2 items are applied. `list_migrations` returns:

- `20261019091540` `archive_satus_demo`
- `20261019091551` `wrap_auth_rls_initplan`
- `20261019091555` `drop_unused_email_send_log_recipient_index`

Source on `main` after #62:

- `supabase/migrations/20261019091540_archive_satus_demo.sql`
- `supabase/migrations/20261019091551_wrap_auth_rls_initplan.sql`
- `supabase/migrations/20261019091555_drop_unused_email_send_log_recipient_index.sql`

The comment inside the archive file still names
`20261019090740_archive_satus_demo.sql`. That path is the name from before
#62. The applied SQL was not edited.

## Archive schema

`satus_demo` and `archive_satus_demo` are absent from `pg_namespace`.
The applied `20261019091540` statement contains
`DROP SCHEMA archive_satus_demo CASCADE` only as a comment
(`Final DROP, not executed`). Postgres logs record a later statement,
`DROP SCHEMA archive_satus_demo CASCADE`, at 2026-10-19T10:01:25.473Z,
source `POST /mcp`.
`schema_migrations` has no row for that drop. There is nothing left to drop.

PR #50 was opened at 2026-10-19T09:32:13Z and said the DROP was still
waiting. That was false from 10:01 UTC the same day.

## Still left in place

- `public.rate_limit_counters` has RLS enabled and zero policies
  (read 2026-10-25). `service_role` has BYPASSRLS. The security advisor
  at 2026-10-25T21:02:52.385Z has one INFO lint, `rls_enabled_no_policy`,
  on that table.
  <https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy>
- `auth_db_connections_absolute`: the 2026-10-19 note said Auth is capped
  at 10 connections. That setting was not re-read on 2026-10-25. Do not
  change it from a migration.

## What those migrations changed

Thirteen public policies use `(SELECT auth.role()) = 'service_role'`:
the three on `email_send_log`, one on `email_send_state`, two on
`suppressed_emails`, three on `email_unsubscribe_tokens`, and one each
on `licenses`, `e2e_health_log`, `satus_runs`, and `webhook_alerts_sent`.
`public.idx_email_send_log_recipient` is absent (`to_regclass` returned
null).

## History

Hosted `schema_migrations` has 11 rows: eight from `20260805102629`
through `20260827213743`, plus the three above. Those 11 filenames exist
under `supabase/migrations/`. Twenty-five other files there have no ledger
row (the `202605*` through `20260714*` copies, and
`20261010203000_retire_e2e_health_pg_cron.sql`). `supabase db push` would
try to apply them. Do not repair that history in passing. `cron.job` has
no `satus-e2e-health-daily`. Job name, schedule, and active were read.
The command column was not.

## Owner, still open

Moved out of `mem/HANDOFF.md` on 2026-10-26. None of these were touched
by the blog wrap change.

- Joel: keep or retire `cli-publish.yml`. The last run is failure
  [36333516038](https://github.com/PasskeyBridge-LLC/satus/actions/runs/36333516038)
  (2026-09-27), step "Report publish auth path". Publish succeeded. No
  other workflow calls this file. The Action and the site install
  `@passkeybridge/satus` from npm.
- Revoke the old npm token (Joel).
- Confirm the Auth leaked-password toggle (Joel). It was not read.
