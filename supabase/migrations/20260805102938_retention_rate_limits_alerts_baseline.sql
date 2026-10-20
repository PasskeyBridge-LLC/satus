-- Baseline replay of repo migrations 20260527090714 .. 20260714122912:
-- retention crons, rate limiter, webhook alert dedup, satus_runs columns.
-- (The email_queue_dispatch/email_queue_wake revokes from 20260701100552 are
-- applied in the email_queue_wake migration that recreates those functions.)

-- === 20260527090714: pin search_path on email RPCs ===
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- === 20260529092142: satus_runs + e2e_health_log retention ===
create or replace function public.prune_satus_runs(retain_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  if retain_days is null or retain_days < 7 then
    raise exception 'retain_days must be >= 7';
  end if;
  delete from public.satus_runs
   where created_at < now() - make_interval(days => retain_days);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.prune_satus_runs(integer) from public, anon, authenticated;
grant execute on function public.prune_satus_runs(integer) to service_role;

do $$
begin
  perform cron.unschedule('prune-satus-runs-daily');
exception when others then null;
end$$;

select cron.schedule(
  'prune-satus-runs-daily',
  '0 3 * * *',
  $cron$select public.prune_satus_runs(90);$cron$
);

create or replace function public.prune_e2e_health_log(retain_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted integer;
begin
  if retain_days is null or retain_days < 7 then
    raise exception 'retain_days must be >= 7';
  end if;
  delete from public.e2e_health_log
   where created_at < now() - make_interval(days => retain_days);
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.prune_e2e_health_log(integer) from public, anon, authenticated;
grant execute on function public.prune_e2e_health_log(integer) to service_role;

do $$
begin
  perform cron.unschedule('prune-e2e-health-log-daily');
exception when others then null;
end$$;

select cron.schedule(
  'prune-e2e-health-log-daily',
  '5 3 * * *',
  $cron$select public.prune_e2e_health_log(90);$cron$
);

-- === 20260529093927: Postgres-backed rate limiter ===
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

GRANT ALL ON public.rate_limit_counters TO service_role;

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS rate_limit_counters_window_idx
  ON public.rate_limit_counters (window_start);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket TEXT,
  p_key TEXT,
  p_window_seconds INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_hits INTEGER;
BEGIN
  v_window_start := to_timestamp(
    (EXTRACT(EPOCH FROM now())::BIGINT / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_counters (bucket, key, window_start, hits)
  VALUES (p_bucket, p_key, v_window_start, 1)
  ON CONFLICT (bucket, key, window_start)
    DO UPDATE SET hits = public.rate_limit_counters.hits + 1
  RETURNING hits INTO v_hits;

  RETURN v_hits;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.prune_rate_limit_counters()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.rate_limit_counters
  WHERE window_start < now() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_rate_limit_counters() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_rate_limit_counters() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('prune-rate-limit-counters');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'prune-rate-limit-counters',
  '0 * * * *',
  $$SELECT public.prune_rate_limit_counters();$$
);

-- === 20260529093950: revoke PUBLIC execute on prune helpers ===
REVOKE EXECUTE ON FUNCTION public.prune_satus_runs(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_satus_runs(INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.prune_e2e_health_log(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_e2e_health_log(INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, TEXT, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.prune_rate_limit_counters() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_rate_limit_counters() TO service_role;

-- === 20260620131216: satus_runs provider/token columns ===
ALTER TABLE public.satus_runs
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer;

-- === 20260620135459: webhook alert dedup ===
CREATE TABLE public.webhook_alerts_sent (
  event_id      text PRIMARY KEY,
  event_type    text,
  environment   text,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.webhook_alerts_sent TO service_role;
GRANT ALL              ON public.webhook_alerts_sent TO service_role;

ALTER TABLE public.webhook_alerts_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access"
  ON public.webhook_alerts_sent
  FOR ALL
  TO service_role
  USING  (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.prune_webhook_alerts_sent(retain_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  deleted integer;
BEGIN
  IF retain_days IS NULL OR retain_days < 7 THEN
    RAISE EXCEPTION 'retain_days must be >= 7';
  END IF;
  DELETE FROM public.webhook_alerts_sent
   WHERE created_at < now() - make_interval(days => retain_days);
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.prune_webhook_alerts_sent(integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.prune_webhook_alerts_sent(integer) TO service_role;

-- === 20260714122912: satus_runs v0.3.3 telemetry columns ===
ALTER TABLE public.satus_runs
  ADD COLUMN IF NOT EXISTS schema_fingerprint  text,
  ADD COLUMN IF NOT EXISTS validator_class     text,
  ADD COLUMN IF NOT EXISTS invocation_sequence jsonb;

COMMENT ON COLUMN public.satus_runs.schema_fingerprint IS
  'v0.3.3 opt-in. SHA-256 of the normalised schema shape. Never contains identifiers or row data. See packages/cli/src/generate/fingerprint.ts.';
COMMENT ON COLUMN public.satus_runs.validator_class IS
  'v0.3.3 opt-in. Name of the validator rule that fired first on a dry-run failure (e.g. "fk_missing_parent"). Bounded to 64 chars in the ingest zod.';
COMMENT ON COLUMN public.satus_runs.invocation_sequence IS
  'v0.3.3 opt-in. Subcommand + flag names only, never flag values. jsonb array of up to 16 short strings.';
