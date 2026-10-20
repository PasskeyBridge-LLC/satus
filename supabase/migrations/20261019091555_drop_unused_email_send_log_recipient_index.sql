-- SAT-2 (2026-10-19): drop the unused recipient index on email_send_log.
--
-- pg_stat_user_indexes.idx_scan is 0 since stats_reset on 2026-07-24.
-- The index is not unique and not a primary key. No function body references
-- it, and application code only writes recipient_email; it does not filter
-- on that column. On the hosted project the table was 105 rows / 136 kB, so
-- a sequential scan is the same work the index was not doing.
--
-- Undo:
--   CREATE INDEX idx_email_send_log_recipient
--     ON public.email_send_log USING btree (recipient_email);

DO $sat2_index$
BEGIN
  EXECUTE 'DROP INDEX public.idx_email_send_log_recipient';

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_email_send_log_recipient'
  ) THEN
    RAISE EXCEPTION 'SAT-2 abort: idx_email_send_log_recipient still exists';
  END IF;
END
$sat2_index$;
