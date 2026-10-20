# Migration ledger alignment (2026-10-20)

Prod project: the satus Supabase project. Ledger: `supabase_migrations.schema_migrations`.

## Superseded duplicates (moved here, not applied)

`20260805131900_schedule_daily_e2e_health.sql` and
`20260810231500_telemetry_privacy_columns.sql` were moved out of
`supabase/migrations/` into this folder. The ledger recorded these migrations as
`20260805131629` and `20260810231400`. Those files were restored from the
recorded SQL in PR #62. The moved files contain the same statements and add
only comments, which are the context lines kept here:

- The schedule file adds a header line that says it was applied on 2026-08-05.
- The telemetry file adds the privacy rationale for the column change.

A read-only check on 2026-10-20 confirmed that `satus_runs.table_count` and
`error_class` exist, and that the three DEPRECATED column comments are present.
These files are kept for their comments only. Do not move them back into
`supabase/migrations/`: they would apply the same SQL a second time.

## 20261010203000_retire_e2e_health_pg_cron.sql (kept, no ledger row)

This file stays in `supabase/migrations/`. Its effect was applied by hand on
2026-10-10 (`cron.unschedule('satus-e2e-health-daily')`), and the ledger has no
row for it. A read-only check on 2026-10-20 found:

- `cron.job` has no `satus-e2e-health-daily` job.
- The last e2e-health run in `cron.job_run_details` was at 2026-10-10 06:00 UTC.
- The daily run is now `.github/workflows/e2e-health.yml`.

The file is idempotent: it catches the error if the job is already gone. Running
it again is harmless. No SQL was run and no ledger row was written for this
note. If a ledger row is wanted, it should come from a reviewed pipeline step,
not a hand insert.
