-- Self-arming email queue dispatch (ported from the Lovable Cloud project,
-- where it was created dynamically outside the repo migrations).
--
-- Mechanism: an AFTER INSERT trigger on the pgmq queue tables arms a
-- 5-second pg_cron job that POSTs to the site's queue processor; the
-- dispatcher unschedules itself once both queues are empty. The processor
-- authenticates the call by comparing the Bearer token to the vault-stored
-- service-role key ('email_queue_service_role_key').
--
-- NOTE: the vault secret must be set once after key issuance:
--   select vault.create_secret('<service_role_key>', 'email_queue_service_role_key');

CREATE OR REPLACE FUNCTION public.email_queue_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
     AND NOT EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
    BEGIN
      -- Serialize disarm against email_queue_wake on a shared advisory lock, then
      -- re-read under it: an enqueue racing the unschedule either committed (we
      -- see its row and leave the cron) or waits and re-arms after we commit.
      PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
      IF EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
         OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
        RETURN;
      END IF;
      PERFORM cron.unschedule('process-email-queue');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_dispatch: cron unschedule failed: %', SQLERRM;
    END;
    RETURN;
  END IF;

  IF (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now() THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://satus.sh/lovable/email/queue/process',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Satus-Context', 'cron',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.email_queue_wake()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Runs inside the enqueue transaction; the outer handler guarantees nothing
  -- below can roll back the customer's email. Shared advisory lock serializes
  -- arming against email_queue_dispatch's disarm.
  PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue') THEN
    BEGIN
      PERFORM cron.schedule('process-email-queue', '5 seconds', $cron$ SELECT public.email_queue_dispatch(); $cron$);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_wake: cron schedule failed: %', SQLERRM;
    END;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://satus.sh/lovable/email/queue/process',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Satus-Context', 'cron',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_queue_wake failed (enqueue preserved): %', SQLERRM;
  RETURN NULL;
END;
$function$;

-- === 20260701100552 (repo): lock down execute ===
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM PUBLIC, anon, authenticated;

-- Wake triggers on the pgmq queue tables (mirrors the live Lovable DB).
DROP TRIGGER IF EXISTS email_queue_wake_auth ON pgmq.q_auth_emails;
CREATE TRIGGER email_queue_wake_auth
  AFTER INSERT ON pgmq.q_auth_emails
  FOR EACH ROW EXECUTE FUNCTION public.email_queue_wake();

DROP TRIGGER IF EXISTS email_queue_wake_transactional ON pgmq.q_transactional_emails;
CREATE TRIGGER email_queue_wake_transactional
  AFTER INSERT ON pgmq.q_transactional_emails
  FOR EACH ROW EXECUTE FUNCTION public.email_queue_wake();
