-- =============================================================
-- Decrypted-view write support + RPC functions for non-encryption SQL
--
-- Purpose: complete the encryption pattern that schema.sql only half-built.
-- The *_decrypted views already exist and handle reads (pgp_sym_decrypt).
-- This file adds the missing write side: INSTEAD OF INSERT/UPDATE triggers
-- so the app can INSERT/UPDATE plaintext directly into the *_decrypted
-- views (via PostgREST/service key, or asyncpg) and have the trigger
-- transparently encrypt and write to the base table.
--
-- Also adds RPC functions for the handful of queries that were never
-- solvable by the view trick regardless of encryption: the pgvector `<=>`
-- operator and multi-table aggregate queries aren't expressible through
-- PostgREST's URL filter syntax, so they're wrapped as callable functions
-- (`POST /rest/v1/rpc/<name>`) instead.
--
-- All trigger and RPC functions are SECURITY DEFINER: they run with the
-- privileges of whoever executes this script (normally `postgres`, which
-- already owns these tables and has vault access), not the caller's role.
-- This means `service_role` only needs EXECUTE/INSERT/UPDATE grants on the
-- functions/views themselves — not blanket access to the base tables.
--
-- Run this once in the Supabase SQL editor, after schema.sql and
-- security_hardening.sql have already been applied.
-- =============================================================

SET search_path = aied, public, extensions;


-- =============================================================
-- SCHEMA-LEVEL GATE
-- Without this, service_role cannot reach ANYTHING in aied — not the
-- views, not the functions below — regardless of any other grant.
-- (This is the fix for the earlier `42501 permission denied for schema
-- aied` error; it was never applied.)
-- =============================================================
GRANT USAGE ON SCHEMA aied TO service_role;


-- =============================================================
-- 1. answers_decrypted — INSERT
-- =============================================================
CREATE OR REPLACE FUNCTION aied.answers_decrypted_insert() RETURNS trigger AS $$
DECLARE
    v_key text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii');
    v_id uuid := COALESCE(NEW.id, gen_random_uuid());
    v_submitted_at timestamptz := COALESCE(NEW.submitted_at, now());
BEGIN
    INSERT INTO aied.answers (id, question_id, user_id, session_id, answer_text, submitted_at)
    VALUES (
        v_id, NEW.question_id, NEW.user_id, NEW.session_id,
        pgp_sym_encrypt(NEW.answer_text, v_key),
        v_submitted_at
    );
    NEW.id := v_id;
    NEW.submitted_at := v_submitted_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_answers_decrypted_insert ON aied.answers_decrypted;
CREATE TRIGGER trg_answers_decrypted_insert
INSTEAD OF INSERT ON aied.answers_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.answers_decrypted_insert();

GRANT INSERT ON aied.answers_decrypted TO service_role;


-- =============================================================
-- 2. answer_behaviour_decrypted — INSERT (upsert on answer_id, handled
--    inside the function since ON CONFLICT can't target a view directly)
-- =============================================================
CREATE OR REPLACE FUNCTION aied.answer_behaviour_decrypted_insert() RETURNS trigger AS $$
DECLARE
    v_key text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii');
    v_id uuid := COALESCE(NEW.id, gen_random_uuid());
BEGIN
    INSERT INTO aied.answer_behaviour
      (id, answer_id, user_id, question_id, session_id,
       active_time_seconds, total_elapsed_seconds, pause_count,
       distraction_ratio, answer_start_delay_seconds, revision_count,
       behaviour_label, time_modifier)
    VALUES (
        v_id, NEW.answer_id, NEW.user_id, NEW.question_id, NEW.session_id,
        NEW.active_time_seconds, NEW.total_elapsed_seconds, NEW.pause_count,
        NEW.distraction_ratio, NEW.answer_start_delay_seconds, NEW.revision_count,
        pgp_sym_encrypt(NEW.behaviour_label, v_key), NEW.time_modifier
    )
    ON CONFLICT (answer_id) DO UPDATE SET
        active_time_seconds = EXCLUDED.active_time_seconds,
        total_elapsed_seconds = EXCLUDED.total_elapsed_seconds,
        pause_count = EXCLUDED.pause_count,
        distraction_ratio = EXCLUDED.distraction_ratio,
        answer_start_delay_seconds = EXCLUDED.answer_start_delay_seconds,
        revision_count = EXCLUDED.revision_count,
        behaviour_label = EXCLUDED.behaviour_label,
        time_modifier = EXCLUDED.time_modifier
    RETURNING id INTO v_id;

    NEW.id := v_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_answer_behaviour_decrypted_insert ON aied.answer_behaviour_decrypted;
CREATE TRIGGER trg_answer_behaviour_decrypted_insert
INSTEAD OF INSERT ON aied.answer_behaviour_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.answer_behaviour_decrypted_insert();

GRANT INSERT ON aied.answer_behaviour_decrypted TO service_role;


-- =============================================================
-- 3. evaluations_decrypted — INSERT
-- =============================================================
CREATE OR REPLACE FUNCTION aied.evaluations_decrypted_insert() RETURNS trigger AS $$
DECLARE
    v_key text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii');
    v_id uuid := COALESCE(NEW.id, gen_random_uuid());
    v_created_at timestamptz := COALESCE(NEW.created_at, now());
BEGIN
    INSERT INTO aied.evaluations (
        id, answer_id, question_id, session_id, user_id,
        factual_correctness_score, structure_score, accuracy_score,
        precision_score, recall_score, wording_score,
        raw_score, time_modifier, final_score,
        concepts_covered, concepts_missed, feedback_text,
        hallucination_flag, hallucination_note,
        evaluator_model, evaluation_temperature, evaluation_top_p,
        checker_model, created_at
    ) VALUES (
        v_id, NEW.answer_id, NEW.question_id, NEW.session_id, NEW.user_id,
        NEW.factual_correctness_score, NEW.structure_score, NEW.accuracy_score,
        NEW.precision_score, NEW.recall_score, NEW.wording_score,
        NEW.raw_score, NEW.time_modifier, NEW.final_score,
        pgp_sym_encrypt(NEW.concepts_covered::text, v_key),
        pgp_sym_encrypt(NEW.concepts_missed::text, v_key),
        pgp_sym_encrypt(NEW.feedback_text, v_key),
        NEW.hallucination_flag,
        CASE WHEN NEW.hallucination_note IS NOT NULL THEN pgp_sym_encrypt(NEW.hallucination_note, v_key) END,
        NEW.evaluator_model, NEW.evaluation_temperature, NEW.evaluation_top_p,
        NEW.checker_model, v_created_at
    );
    NEW.id := v_id;
    NEW.created_at := v_created_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_evaluations_decrypted_insert ON aied.evaluations_decrypted;
CREATE TRIGGER trg_evaluations_decrypted_insert
INSTEAD OF INSERT ON aied.evaluations_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.evaluations_decrypted_insert();

GRANT INSERT ON aied.evaluations_decrypted TO service_role;


-- =============================================================
-- 4. goal_chat_history_decrypted — INSERT
-- =============================================================
CREATE OR REPLACE FUNCTION aied.goal_chat_history_decrypted_insert() RETURNS trigger AS $$
DECLARE
    v_key text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii');
    v_id uuid := COALESCE(NEW.id, gen_random_uuid());
    v_created_at timestamptz := COALESCE(NEW.created_at, now());
BEGIN
    INSERT INTO aied.goal_chat_history (id, user_id, role, content, created_at)
    VALUES (v_id, NEW.user_id, NEW.role, pgp_sym_encrypt(NEW.content, v_key), v_created_at);
    NEW.id := v_id;
    NEW.created_at := v_created_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_goal_chat_history_decrypted_insert ON aied.goal_chat_history_decrypted;
CREATE TRIGGER trg_goal_chat_history_decrypted_insert
INSTEAD OF INSERT ON aied.goal_chat_history_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.goal_chat_history_decrypted_insert();

GRANT INSERT ON aied.goal_chat_history_decrypted TO service_role;


-- =============================================================
-- 5. student_goals_decrypted — INSERT
-- =============================================================
CREATE OR REPLACE FUNCTION aied.student_goals_decrypted_insert() RETURNS trigger AS $$
DECLARE
    v_key text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii');
    v_id uuid := COALESCE(NEW.id, gen_random_uuid());
    v_created_at timestamptz := COALESCE(NEW.created_at, now());
    v_updated_at timestamptz := COALESCE(NEW.updated_at, now());
BEGIN
    INSERT INTO aied.student_goals (id, user_id, goal_text, goal_structured, topic_id, status, created_at, updated_at)
    VALUES (
        v_id, NEW.user_id,
        pgp_sym_encrypt(NEW.goal_text, v_key),
        CASE WHEN NEW.goal_structured IS NOT NULL THEN pgp_sym_encrypt(NEW.goal_structured::text, v_key) END,
        NEW.topic_id, COALESCE(NEW.status, 'active'), v_created_at, v_updated_at
    );
    NEW.id := v_id;
    NEW.created_at := v_created_at;
    NEW.updated_at := v_updated_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_student_goals_decrypted_insert ON aied.student_goals_decrypted;
CREATE TRIGGER trg_student_goals_decrypted_insert
INSTEAD OF INSERT ON aied.student_goals_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.student_goals_decrypted_insert();

GRANT INSERT ON aied.student_goals_decrypted TO service_role;


-- =============================================================
-- 6. recommendations_decrypted — INSERT (create) + UPDATE (mark viewed)
-- =============================================================
CREATE OR REPLACE FUNCTION aied.recommendations_decrypted_insert() RETURNS trigger AS $$
DECLARE
    v_key text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii');
    v_id uuid := COALESCE(NEW.id, gen_random_uuid());
    v_created_at timestamptz := COALESCE(NEW.created_at, now());
BEGIN
    INSERT INTO aied.recommendations (id, user_id, session_id, chunk_id, topic_id, reason, priority, viewed, viewed_at, created_at)
    VALUES (
        v_id, NEW.user_id, NEW.session_id, NEW.chunk_id, NEW.topic_id,
        pgp_sym_encrypt(NEW.reason, v_key), NEW.priority,
        COALESCE(NEW.viewed, false), NEW.viewed_at, v_created_at
    );
    NEW.id := v_id;
    NEW.created_at := v_created_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_recommendations_decrypted_insert ON aied.recommendations_decrypted;
CREATE TRIGGER trg_recommendations_decrypted_insert
INSTEAD OF INSERT ON aied.recommendations_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.recommendations_decrypted_insert();

-- reason is immutable after creation; the app only ever updates viewed/viewed_at
CREATE OR REPLACE FUNCTION aied.recommendations_decrypted_update() RETURNS trigger AS $$
BEGIN
    UPDATE aied.recommendations
    SET viewed = NEW.viewed, viewed_at = NEW.viewed_at
    WHERE id = OLD.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_recommendations_decrypted_update ON aied.recommendations_decrypted;
CREATE TRIGGER trg_recommendations_decrypted_update
INSTEAD OF UPDATE ON aied.recommendations_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.recommendations_decrypted_update();

GRANT INSERT, UPDATE ON aied.recommendations_decrypted TO service_role;


-- =============================================================
-- 7. progress_snapshots_decrypted — INSERT (upsert on user_id, topic_id,
--    snapshot_date, handled inside the function)
-- =============================================================
CREATE OR REPLACE FUNCTION aied.progress_snapshots_decrypted_insert() RETURNS trigger AS $$
DECLARE
    v_key text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii');
    v_id uuid := COALESCE(NEW.id, gen_random_uuid());
BEGIN
    INSERT INTO aied.progress_snapshots (
        id, user_id, topic_id, snapshot_date,
        avg_factual_correctness, avg_structure, avg_accuracy,
        avg_precision, avg_recall, avg_wording,
        avg_raw_score, avg_final_score, avg_time_modifier,
        dominant_behaviour, questions_attempted, sessions_completed, goal_proximity
    ) VALUES (
        v_id, NEW.user_id, NEW.topic_id, COALESCE(NEW.snapshot_date, CURRENT_DATE),
        NEW.avg_factual_correctness, NEW.avg_structure, NEW.avg_accuracy,
        NEW.avg_precision, NEW.avg_recall, NEW.avg_wording,
        NEW.avg_raw_score, NEW.avg_final_score, NEW.avg_time_modifier,
        CASE WHEN NEW.dominant_behaviour IS NOT NULL THEN pgp_sym_encrypt(NEW.dominant_behaviour, v_key) END,
        NEW.questions_attempted, NEW.sessions_completed, NEW.goal_proximity
    )
    ON CONFLICT (user_id, topic_id, snapshot_date) DO UPDATE SET
        avg_factual_correctness = EXCLUDED.avg_factual_correctness,
        avg_structure = EXCLUDED.avg_structure,
        avg_accuracy = EXCLUDED.avg_accuracy,
        avg_precision = EXCLUDED.avg_precision,
        avg_recall = EXCLUDED.avg_recall,
        avg_wording = EXCLUDED.avg_wording,
        avg_raw_score = EXCLUDED.avg_raw_score,
        avg_final_score = EXCLUDED.avg_final_score,
        avg_time_modifier = EXCLUDED.avg_time_modifier,
        dominant_behaviour = EXCLUDED.dominant_behaviour,
        questions_attempted = EXCLUDED.questions_attempted,
        sessions_completed = EXCLUDED.sessions_completed
    RETURNING id INTO v_id;

    NEW.id := v_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

DROP TRIGGER IF EXISTS trg_progress_snapshots_decrypted_insert ON aied.progress_snapshots_decrypted;
CREATE TRIGGER trg_progress_snapshots_decrypted_insert
INSTEAD OF INSERT ON aied.progress_snapshots_decrypted
FOR EACH ROW EXECUTE FUNCTION aied.progress_snapshots_decrypted_insert();

GRANT INSERT ON aied.progress_snapshots_decrypted TO service_role;


-- =============================================================
-- RPC FUNCTIONS — for SQL that has nothing to do with encryption and was
-- never expressible through PostgREST's URL filter DSL (custom operators,
-- multi-table aggregates). Called via POST /rest/v1/rpc/<name>.
-- =============================================================

-- Hybrid search: pgvector cosine similarity (60%) + full-text rank (40%).
-- The `<=>` operator and computed ranking can't be expressed as REST filters.
-- p_query_embedding is text (e.g. "[0.1,0.2,...]"), cast to vector inside the
-- function — the same string-building approach ingestion.py already uses,
-- rather than relying on untested PostgREST JSON-array-to-vector coercion.
CREATE OR REPLACE FUNCTION aied.hybrid_search(
    p_query_embedding text,
    p_query_text text,
    p_difficulty text,
    p_top_k int
) RETURNS TABLE (
    id uuid,
    content text,
    page_start int,
    page_end int,
    chapter varchar,
    section varchar,
    document_id uuid,
    topic_id uuid,
    book_title varchar,
    book_author varchar,
    hybrid_score double precision
) AS $$
    SELECT
        dc.id,
        dc.content,
        dc.page_start,
        dc.page_end,
        dc.chapter,
        dc.section,
        dc.document_id,
        dc.topic_id,
        d.title AS book_title,
        d.author AS book_author,
        (
            0.6 * (1 - (dc.embedding <=> p_query_embedding::public.vector))
            + 0.4 * ts_rank(dc.fts_vector, plainto_tsquery('english', p_query_text))
        ) AS hybrid_score
    FROM aied.document_chunks dc
    JOIN aied.documents d ON dc.document_id = d.id
    WHERE
        (p_difficulty IS NULL OR dc.difficulty = p_difficulty)
        AND dc.fts_vector @@ plainto_tsquery('english', p_query_text)
    ORDER BY hybrid_score DESC
    LIMIT p_top_k;
-- public is included here because pgvector (confirmed via pg_extension/pg_namespace
-- query) is installed in the public schema on this project, not extensions —
-- CREATE EXTENSION IF NOT EXISTS ... SCHEMA extensions in schema.sql was a no-op
-- since the extension already existed (likely enabled via the Dashboard toggle,
-- which defaults to public) by the time that script ran.
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = aied, public, extensions;

GRANT EXECUTE ON FUNCTION aied.hybrid_search(text, text, text, int) TO service_role;


-- Best-matching chunk for a set of missed concepts (full-text ranked).
CREATE OR REPLACE FUNCTION aied.find_best_chunk_for_concepts(
    p_topic_id uuid,
    p_concept_query text
) RETURNS TABLE (chunk_id uuid, topic_id uuid) AS $$
    SELECT dc.id, dc.topic_id
    FROM aied.document_chunks dc
    WHERE (p_topic_id IS NULL OR dc.topic_id = p_topic_id)
      AND dc.fts_vector @@ plainto_tsquery('english', p_concept_query)
    ORDER BY ts_rank(dc.fts_vector, plainto_tsquery('english', p_concept_query)) DESC
    LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = aied, extensions;

GRANT EXECUTE ON FUNCTION aied.find_best_chunk_for_concepts(uuid, text) TO service_role;


-- Session completion average — AVG across a JOIN, not expressible as a REST filter.
CREATE OR REPLACE FUNCTION aied.session_avg_final_score(p_session_id uuid) RETURNS numeric AS $$
    SELECT AVG(e.final_score)
    FROM aied.evaluations e
    JOIN aied.questions q ON e.question_id = q.id
    WHERE q.session_id = p_session_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = aied, extensions;

GRANT EXECUTE ON FUNCTION aied.session_avg_final_score(uuid) TO service_role;


-- Topic progress snapshot stats: per-topic score averages, dominant
-- behaviour (grouped on the DECRYPTED label — pgp_sym_encrypt is
-- non-deterministic, so grouping on ciphertext would never match equal
-- labels), and completed-session count. Combines what was 3 separate
-- round trips in the old asyncpg code into 1 call.
CREATE OR REPLACE FUNCTION aied.topic_progress_stats(
    p_session_id uuid,
    p_topic_id uuid,
    p_user_id uuid
) RETURNS TABLE (
    avg_factual_correctness numeric,
    avg_structure numeric,
    avg_accuracy numeric,
    avg_precision numeric,
    avg_recall numeric,
    avg_wording numeric,
    avg_raw_score numeric,
    avg_final_score numeric,
    avg_time_modifier numeric,
    questions_attempted bigint,
    dominant_behaviour text,
    sessions_completed bigint
) AS $$
    SELECT
        stats.avg_factual_correctness, stats.avg_structure, stats.avg_accuracy,
        stats.avg_precision, stats.avg_recall, stats.avg_wording,
        stats.avg_raw_score, stats.avg_final_score, stats.avg_time_modifier,
        stats.questions_attempted,
        (
            SELECT ab.behaviour_label
            FROM aied.answer_behaviour_decrypted ab
            JOIN aied.answers a ON ab.answer_id = a.id
            JOIN aied.questions q2 ON a.question_id = q2.id
            WHERE q2.session_id = p_session_id AND q2.topic_id = p_topic_id
            GROUP BY ab.behaviour_label ORDER BY COUNT(*) DESC LIMIT 1
        ) AS dominant_behaviour,
        (
            SELECT COUNT(*) FROM aied.test_sessions
            WHERE user_id = p_user_id AND status = 'completed'
        ) AS sessions_completed
    FROM (
        SELECT
          AVG(e.factual_correctness_score) AS avg_factual_correctness,
          AVG(e.structure_score)           AS avg_structure,
          AVG(e.accuracy_score)            AS avg_accuracy,
          AVG(e.precision_score)           AS avg_precision,
          AVG(e.recall_score)              AS avg_recall,
          AVG(e.wording_score)             AS avg_wording,
          AVG(e.raw_score)                 AS avg_raw_score,
          AVG(e.final_score)               AS avg_final_score,
          AVG(e.time_modifier)             AS avg_time_modifier,
          COUNT(*)                         AS questions_attempted
        FROM aied.evaluations e
        JOIN aied.questions q ON e.question_id = q.id
        WHERE q.session_id = p_session_id AND q.topic_id = p_topic_id
    ) stats;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = aied, vault, extensions;

GRANT EXECUTE ON FUNCTION aied.topic_progress_stats(uuid, uuid, uuid) TO service_role;


-- Records a document view/download, atomically incrementing counters on
-- conflict. Not expressible as a plain REST upsert (Prefer:
-- resolution=merge-duplicates overwrites fields; it can't say "increment
-- the existing value").
CREATE OR REPLACE FUNCTION aied.record_document_access(
    p_user_id uuid,
    p_document_id uuid,
    p_downloaded boolean
) RETURNS void AS $$
    INSERT INTO aied.user_documents
      (id, user_id, document_id, first_accessed_at, last_accessed_at,
       access_count, downloaded, download_count, last_downloaded_at)
    VALUES (
        gen_random_uuid(), p_user_id, p_document_id, now(), now(), 1,
        p_downloaded, CASE WHEN p_downloaded THEN 1 ELSE 0 END,
        CASE WHEN p_downloaded THEN now() END
    )
    ON CONFLICT (user_id, document_id) DO UPDATE SET
        last_accessed_at = now(),
        access_count = aied.user_documents.access_count + 1,
        downloaded = aied.user_documents.downloaded OR EXCLUDED.downloaded,
        download_count = aied.user_documents.download_count + CASE WHEN p_downloaded THEN 1 ELSE 0 END,
        last_downloaded_at = CASE WHEN p_downloaded THEN now() ELSE aied.user_documents.last_downloaded_at END;
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = aied, extensions;

GRANT EXECUTE ON FUNCTION aied.record_document_access(uuid, uuid, boolean) TO service_role;


-- =============================================================
-- Remaining plain-CRUD base tables the app still talks to directly
-- (no encrypted columns involved, so no view/trigger needed — just the
-- schema-usage gate above plus these object-level grants).
-- =============================================================
GRANT SELECT, INSERT, UPDATE ON aied.users TO service_role;
GRANT SELECT, INSERT, UPDATE ON aied.test_sessions TO service_role;
GRANT SELECT, INSERT ON aied.questions TO service_role;
GRANT INSERT ON aied.question_events TO service_role;
GRANT SELECT, INSERT, DELETE ON aied.topics TO service_role;
GRANT SELECT ON aied.answer_behaviour TO service_role;          -- non-encrypted time_modifier lookup
GRANT SELECT, INSERT ON aied.documents TO service_role;
GRANT SELECT ON aied.document_chunks TO service_role;
GRANT SELECT ON aied.user_documents TO service_role;  -- writes go through record_document_access() above
