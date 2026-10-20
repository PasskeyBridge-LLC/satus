-- Baseline replay of repo migrations 20260526122807 .. 20260526161356:
-- licenses, e2e health log, satus_demo schema, satus_runs telemetry,
-- grants, and email RPC hardening.

-- === 20260526122807: licenses ===
create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_key text not null unique,
  email text not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  plan text not null,
  status text not null default 'active',
  environment text not null default 'live',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index idx_licenses_email on public.licenses (lower(email));
create index idx_licenses_customer on public.licenses (stripe_customer_id);

alter table public.licenses enable row level security;

create policy "service role full access licenses"
  on public.licenses for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.licenses_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger licenses_touch_updated_at
  before update on public.licenses
  for each row execute function public.licenses_touch_updated_at();

-- === 20260526123932: e2e health log + permanent test license ===
CREATE TABLE public.e2e_health_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('pass','fail')),
  duration_ms integer NOT NULL,
  checks jsonb NOT NULL,
  error_message text,
  triggered_by text NOT NULL DEFAULT 'cron'
);

ALTER TABLE public.e2e_health_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access e2e_health_log"
  ON public.e2e_health_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_e2e_health_log_created_at ON public.e2e_health_log (created_at DESC);

INSERT INTO public.licenses (
  license_key, email, stripe_customer_id, stripe_subscription_id,
  plan, status, environment
) VALUES (
  'satus_test_e2e0000000000000000000000000000',
  'e2e+monitor@satus.sh',
  'cus_e2e_monitor',
  'sub_e2e_monitor',
  'monitor',
  'active',
  'test'
) ON CONFLICT DO NOTHING;

-- === 20260526152105: satus_demo schema + satus_runs telemetry ===
CREATE SCHEMA IF NOT EXISTS satus_demo;

CREATE TABLE satus_demo.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE satus_demo.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES satus_demo.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE satus_demo.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES satus_demo.projects(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES satus_demo.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.satus_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',  -- running | success | failed
  license_key text,
  profile text,
  model text,
  target_schema text,
  tables jsonb,         -- [{name, rows_generated}]
  total_rows integer,
  total_cost_usd numeric(10, 6),
  duration_ms integer,
  error_message text,
  cli_version text,
  environment text NOT NULL DEFAULT 'dev'
);

GRANT SELECT, INSERT, UPDATE ON public.satus_runs TO authenticated;
GRANT ALL ON public.satus_runs TO service_role;

ALTER TABLE public.satus_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access satus_runs"
ON public.satus_runs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- === 20260526152437 + 20260526152510: satus_demo grants ===
GRANT USAGE ON SCHEMA satus_demo TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL TABLES IN SCHEMA satus_demo TO anon, authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA satus_demo TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA satus_demo GRANT ALL ON TABLES TO anon, authenticated, service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA satus_demo GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, postgres;

GRANT USAGE ON SCHEMA satus_demo TO PUBLIC;
GRANT ALL ON ALL TABLES IN SCHEMA satus_demo TO PUBLIC;
GRANT ALL ON ALL SEQUENCES IN SCHEMA satus_demo TO PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA satus_demo GRANT ALL ON TABLES TO PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA satus_demo GRANT ALL ON SEQUENCES TO PUBLIC;

-- === 20260526161356: email RPC hardening ===
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
