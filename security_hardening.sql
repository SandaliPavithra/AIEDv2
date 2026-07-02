-- =============================================================
-- AIEDv2 — Security hardening for the already-provisioned database
-- Run ONCE in the Supabase SQL editor to fix the database linter findings
-- (RLS disabled, sensitive columns exposed, SECURITY DEFINER views).
--
-- Safe to run: the backend only ever connects via asyncpg as the
-- `postgres` role (bypasses RLS) and uses supabase-py for Storage only.
-- Nothing in the app queries the `aied` schema via PostgREST as
-- anon/authenticated, so enabling RLS with no policies changes nothing
-- for the app and denies the previously-exposed API access by default.
--
-- Prerequisite: Postgres 15+ (required for view `security_invoker`).
-- Check with: SELECT version();
-- =============================================================

SET search_path TO aied, public, extensions;

-- -------------------------------------------------------------
-- 1. Enable RLS on every base table (no policies = deny all to
--    anon/authenticated; `postgres` and `service_role` still bypass RLS).
-- -------------------------------------------------------------
ALTER TABLE topics              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_consents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_goals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_chat_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_behaviour     ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_snapshots   ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------
-- 2. Make the decryption views enforce RLS/permissions of the
--    querying role instead of the view owner. The backend's `postgres`
--    role already has vault decrypt access, so decryption keeps working;
--    anon/authenticated now get zero rows instead of bypassing RLS.
-- -------------------------------------------------------------
ALTER VIEW student_profiles_decrypted    SET (security_invoker = true);
ALTER VIEW student_goals_decrypted       SET (security_invoker = true);
ALTER VIEW goal_chat_history_decrypted   SET (security_invoker = true);
ALTER VIEW answers_decrypted             SET (security_invoker = true);
ALTER VIEW answer_behaviour_decrypted    SET (security_invoker = true);
ALTER VIEW evaluations_decrypted         SET (security_invoker = true);
ALTER VIEW recommendations_decrypted     SET (security_invoker = true);
ALTER VIEW progress_snapshots_decrypted  SET (security_invoker = true);

-- -------------------------------------------------------------
-- 3. Optional extra hardening: explicitly strip any anon/authenticated
--    grants on the schema that may have been added when `aied` was
--    exposed to the Data API. Safe no-op if they were never granted.
--    Existing `GRANT SELECT ... TO authenticated` on the *_decrypted
--    views (see schema.sql) is left in place — it's now harmless
--    because RLS + security_invoker mean authenticated sees 0 rows.
-- -------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA aied FROM anon;
REVOKE ALL ON SCHEMA aied FROM anon;

-- -------------------------------------------------------------
-- 4. Verify — re-run the database linter (or MCP get_advisors) after
--    this script to confirm all findings are cleared.
-- -------------------------------------------------------------
