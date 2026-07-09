-- =============================================================
-- Multi-topic quiz sessions
--
-- test_sessions.topic_id (single FK) is replaced by a session_topics
-- junction table so a session can draw questions from more than one
-- topic. Per-question topic_id (questions.topic_id, set from the chunk
-- it was generated from) already supported mixed-topic sessions at the
-- question level — this migration just lets the *selection* be
-- multi-valued too.
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- security_hardening.sql, decrypted_view_writes_and_rpc.sql, and
-- add_mcq_and_behaviour_columns.sql have already been applied.
-- =============================================================

SET search_path = aied, public, extensions;


-- =============================================================
-- 1. session_topics — one row per (session, selected topic)
-- =============================================================
CREATE TABLE IF NOT EXISTS aied.session_topics (
    session_id UUID NOT NULL REFERENCES aied.test_sessions(id) ON DELETE CASCADE,
    topic_id   UUID NOT NULL REFERENCES aied.topics(id),
    PRIMARY KEY (session_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_session_topics_topic ON aied.session_topics(topic_id);

ALTER TABLE aied.session_topics ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- 2. Backfill existing sessions' single topic_id into the new table
-- before the column is dropped.
-- =============================================================
INSERT INTO aied.session_topics (session_id, topic_id)
SELECT id, topic_id FROM aied.test_sessions
ON CONFLICT DO NOTHING;


-- =============================================================
-- 3. Drop the now-redundant single-topic column + its index.
-- =============================================================
DROP INDEX IF EXISTS aied.idx_sessions_topic;
ALTER TABLE aied.test_sessions DROP COLUMN IF EXISTS topic_id;
