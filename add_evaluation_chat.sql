-- =============================================================
-- Evaluation dashboard, chat phase — evaluation_chat_history table
--
-- Mirrors goal_chat_history exactly (same columns, same encryption,
-- same append-only role/content shape) — this is the persisted
-- conversation log for the new evaluation-analysis chatbot
-- (backend/app/routers/evaluation_chat.py), which grounds every reply in
-- the student's real progress_snapshots + evaluations rows rather than
-- letting the model freely judge from raw answer text.
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- security_hardening.sql, decrypted_view_writes_and_rpc.sql, and the two
-- earlier phase-1 migrations have already been applied.
-- =============================================================

SET search_path = aied, public, extensions;


-- =============================================================
-- 1. evaluation_chat_history — base table
-- =============================================================
CREATE TABLE IF NOT EXISTS aied.evaluation_chat_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES aied.users(id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content    BYTEA       NOT NULL,   -- encrypted: message text
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_chat_user ON aied.evaluation_chat_history(user_id, created_at);


-- =============================================================
-- 2. evaluation_chat_history_decrypted — read view
-- =============================================================
CREATE OR REPLACE VIEW aied.evaluation_chat_history_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    user_id,
    role,
    pgp_sym_decrypt(content, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii')) AS content,
    created_at
FROM aied.evaluation_chat_history;


-- =============================================================
-- 3. evaluation_chat_history_decrypted — INSERT
-- =============================================================
CREATE OR REPLACE FUNCTION aied.evaluation_chat_history_decrypted_insert() RETURNS trigger AS $$
DECLARE
    v_key text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii');
    v_id uuid := COALESCE(NEW.id, gen_random_uuid());
    v_created_at timestamptz := COALESCE(NEW.created_at, now());
BEGIN
    INSERT INTO aied.evaluation_chat_history (id, user_id, role, content, created_at)
    VALUES (v_id, NEW.user_id, NEW.role, pgp_sym_encrypt(NEW.content, v_key), v_created_at);
    NEW.id := v_id;
    NEW.created_at := v_created_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_evaluation_chat_history_decrypted_insert ON aied.evaluation_chat_history_decrypted;
CREATE TRIGGER trg_evaluation_chat_history_decrypted_insert
INSTEAD OF INSERT ON aied.evaluation_chat_history_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.evaluation_chat_history_decrypted_insert();


-- =============================================================
-- 4. Permissions — same shape as goal_chat_history_decrypted: SELECT to
-- both roles (schema.sql's PERMISSIONS convention), INSERT to service_role
-- only (the backend is the only writer, always via the service key).
-- =============================================================
GRANT SELECT ON aied.evaluation_chat_history_decrypted TO service_role, authenticated;
GRANT INSERT ON aied.evaluation_chat_history_decrypted TO service_role;
