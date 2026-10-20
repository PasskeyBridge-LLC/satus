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
