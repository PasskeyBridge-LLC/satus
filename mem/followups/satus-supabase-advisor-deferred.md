# Deferred satus Supabase advisor items

**Status:** open. From the 2026-10-19 read-only review, project
`xbnrjwzryuonuinzuomk`, section 4. SAT-1 and the safe SAT-2 items shipped
in PR #49 (`1ee06cf`) and were applied once on 2026-10-19 as
`20261019091540` `archive_satus_demo`, `20261019091551`
`wrap_auth_rls_initplan`, and `20261019091555`
`drop_unused_email_send_log_recipient_index`. Source is
`supabase/migrations/20261019090740_archive_satus_demo.sql`,
`20261019090741_wrap_auth_rls_initplan.sql`, and
`20261019090742_drop_unused_email_send_log_recipient_index.sql`.

## Left in place

- `public.rate_limit_counters` has RLS and no policy. That is the
  service-only shape: `service_role` has BYPASSRLS, and everyone else is
  denied. Adding a policy would change that. Advisor lint
  `rls_enabled_no_policy`.
- `auth_db_connections_absolute`: Auth is capped at 10 connections. This is
  an Auth server setting, not SQL, and satus has no staging project. Leave
  it until Joel switches Auth to a percentage allocation in the project
  settings. Do not change it from a migration.

## DROP, waiting for Joel

`archive_satus_demo` (former `satus_demo`: `users`, `projects`, `tasks`)
was empty on 2026-10-19. Do not drop it until Joel says so:

```sql
DROP SCHEMA archive_satus_demo CASCADE;
```

## History

Hosted `schema_migrations` is the 2026-08-05 baseline (8 versions) plus the
three versions above, not the filenames in `supabase/migrations`.
`supabase db push` would try to replay the old files. Do not repair that
history in passing. The archive tables now also show
`rls_enabled_no_policy` (RLS on, no policy, same deny-by-default shape as
`rate_limit_counters`) and `unused_index` on the three foreign-key indexes
added at archive time. Leave both.
