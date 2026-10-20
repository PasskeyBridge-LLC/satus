-- SAT-1 (2026-10-19): archive the unused satus_demo schema.
--
-- The schema was created for CLI end-to-end validation and is not referenced
-- by application code, edge functions, scripts, workflows, views, or cron.
-- Its three tables (users, projects, tasks) are empty, have no policies, and
-- had RLS disabled. anon, authenticated, service_role, and PUBLIC held USAGE
-- on the schema and full table privileges (arwdDxtm), including via PUBLIC,
-- so exposing the schema in the Data API would have made it world-writable.
-- This migration does not DROP anything. It runs as one statement so a
-- failure rolls the whole change back.
--
-- Undo, as one transaction. Run it as postgres. It restores the grants
-- captured on 2026-10-19 from pg_namespace.nspacl, pg_class.relacl, and
-- pg_default_acl, and it removes the foreign-key indexes this migration adds.
--
--   DROP INDEX IF EXISTS archive_satus_demo.tasks_assignee_id_idx;
--   DROP INDEX IF EXISTS archive_satus_demo.tasks_project_id_idx;
--   DROP INDEX IF EXISTS archive_satus_demo.projects_owner_id_idx;
--   ALTER SCHEMA archive_satus_demo RENAME TO satus_demo;
--   ALTER TABLE satus_demo.users DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE satus_demo.projects DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE satus_demo.tasks DISABLE ROW LEVEL SECURITY;
--   COMMENT ON SCHEMA satus_demo IS NULL;
--   COMMENT ON TABLE satus_demo.users IS NULL;
--   COMMENT ON TABLE satus_demo.projects IS NULL;
--   COMMENT ON TABLE satus_demo.tasks IS NULL;
--   GRANT USAGE ON SCHEMA satus_demo TO anon, authenticated, service_role, postgres;
--   GRANT USAGE ON SCHEMA satus_demo TO PUBLIC;
--   GRANT ALL ON ALL TABLES IN SCHEMA satus_demo TO anon, authenticated, service_role, postgres;
--   GRANT ALL ON ALL TABLES IN SCHEMA satus_demo TO PUBLIC;
--   GRANT ALL ON ALL SEQUENCES IN SCHEMA satus_demo TO anon, authenticated, service_role, postgres;
--   GRANT ALL ON ALL SEQUENCES IN SCHEMA satus_demo TO PUBLIC;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA satus_demo
--     GRANT ALL ON TABLES TO anon, authenticated, service_role, postgres, PUBLIC;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA satus_demo
--     GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, postgres, PUBLIC;
--
-- Final DROP, not executed, awaiting Joel's approval:
--   DROP SCHEMA archive_satus_demo CASCADE;

DO $sat1$
DECLARE
  users_n bigint;
  projects_n bigint;
  tasks_n bigint;
  leftover integer;
  rls_off integer;
BEGIN
  -- Access-exclusive locks, then the emptiness check, all in this statement.
  EXECUTE 'ALTER TABLE satus_demo.users ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE satus_demo.projects ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE satus_demo.tasks ENABLE ROW LEVEL SECURITY';

  SELECT count(*) INTO users_n FROM satus_demo.users;
  SELECT count(*) INTO projects_n FROM satus_demo.projects;
  SELECT count(*) INTO tasks_n FROM satus_demo.tasks;
  IF users_n <> 0 OR projects_n <> 0 OR tasks_n <> 0 THEN
    RAISE EXCEPTION
      'SAT-1 abort: satus_demo is not empty (users %, projects %, tasks %)',
      users_n, projects_n, tasks_n;
  END IF;

  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA satus_demo FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA satus_demo FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA satus_demo FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'REVOKE USAGE, CREATE ON SCHEMA satus_demo FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA satus_demo REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role, postgres';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA satus_demo REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role, postgres';
  EXECUTE 'ALTER SCHEMA satus_demo RENAME TO archive_satus_demo';

  EXECUTE $comment$COMMENT ON SCHEMA archive_satus_demo IS 'Archived 2026-10-19 for review finding SAT-1. Renamed from satus_demo. RLS was disabled and anon, authenticated, and PUBLIC had USAGE plus full table DML. The three tables were empty and unused. Not dropped. Undo is in supabase/migrations/20261019090740_archive_satus_demo.sql.'$comment$;
  EXECUTE $comment$COMMENT ON TABLE archive_satus_demo.users IS 'Archived 2026-10-19 for review finding SAT-1. Moved with schema satus_demo to archive_satus_demo. Empty and unused. Not dropped.'$comment$;
  EXECUTE $comment$COMMENT ON TABLE archive_satus_demo.projects IS 'Archived 2026-10-19 for review finding SAT-1. Moved with schema satus_demo to archive_satus_demo. Empty and unused. Not dropped.'$comment$;
  EXECUTE $comment$COMMENT ON TABLE archive_satus_demo.tasks IS 'Archived 2026-10-19 for review finding SAT-1. Moved with schema satus_demo to archive_satus_demo. Empty and unused. Not dropped.'$comment$;

  -- SAT-2: these three unindexed foreign keys lived on the empty tables.
  EXECUTE 'CREATE INDEX projects_owner_id_idx ON archive_satus_demo.projects (owner_id)';
  EXECUTE 'CREATE INDEX tasks_project_id_idx ON archive_satus_demo.tasks (project_id)';
  EXECUTE 'CREATE INDEX tasks_assignee_id_idx ON archive_satus_demo.tasks (assignee_id)';

  SELECT count(*) INTO leftover
  FROM (
    SELECT 1
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(n.nspacl) AS a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'archive_satus_demo'
      AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'))
    UNION ALL
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) AS a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE n.nspname = 'archive_satus_demo'
      AND c.relkind IN ('r', 'S')
      AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'))
    UNION ALL
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) AS a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    WHERE d.defaclnamespace = 'archive_satus_demo'::regnamespace
      AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'))
  ) AS leaks;

  IF leftover <> 0 THEN
    RAISE EXCEPTION
      'SAT-1 abort: % anon, authenticated, service_role, or PUBLIC grants remain on archive_satus_demo',
      leftover;
  END IF;

  SELECT count(*) INTO rls_off
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'archive_satus_demo'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity;

  IF rls_off <> 0 THEN
    RAISE EXCEPTION
      'SAT-1 abort: % archive_satus_demo tables still have RLS disabled',
      rls_off;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'archive_satus_demo' AND indexname = 'projects_owner_id_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'archive_satus_demo' AND indexname = 'tasks_project_id_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'archive_satus_demo' AND indexname = 'tasks_assignee_id_idx'
  ) THEN
    RAISE EXCEPTION 'SAT-1 abort: foreign-key covering indexes were not created';
  END IF;
END
$sat1$;
