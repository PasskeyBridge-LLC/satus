-- satus_runs: replace the identifying telemetry columns with non-identifying ones.
--
-- The published privacy promise (packages/cli/README.md, satus.sh/privacy)
-- states that satus never sends table names, column names, or row data to
-- satus.sh. Three columns on this table contradicted it:
--
--   tables         jsonb  -- every table name in the run
--   target_schema  text   -- the schema name, itself a tenant identifier
--                            in multi-tenant setups
--   error_message  text   -- raw error text; Postgres unique-violation
--                            messages embed the offending row value, e.g.
--                            'Key (email)=(ada@example.com) already exists'
--
-- CLI v0.3.7 stops sending them and /api/public/cli/run now strips them
-- from any payload an older CLI still sends. This migration adds the two
-- replacement columns.
--
-- The three legacy columns are intentionally NOT dropped here. Dropping a
-- column is irreversible and the existing rows are operator test runs that
-- may still be wanted for release history; they are left in place, no longer
-- written to, and can be purged separately.

alter table public.satus_runs
  add column if not exists table_count integer,
  add column if not exists error_class text;

comment on column public.satus_runs.table_count is
  'Number of tables the run touched. Replaces the per-table "tables" array (v0.3.7).';

comment on column public.satus_runs.error_class is
  'Fixed-vocabulary failure class from the CLI (pg_<sqlstate>, provider_http_<code>, budget_exceeded, ...). Replaces free-text error_message (v0.3.7). Never contains schema identifiers or row values.';

comment on column public.satus_runs.tables is
  'DEPRECATED (v0.3.7): carried table names, contradicting the published privacy promise. No longer written by the ingest route.';

comment on column public.satus_runs.target_schema is
  'DEPRECATED (v0.3.7): carried the schema name. No longer written by the ingest route.';

comment on column public.satus_runs.error_message is
  'DEPRECATED (v0.3.7): carried raw error text, which can embed identifiers and row values. No longer written by the ingest route; superseded by error_class.';
