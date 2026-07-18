-- =============================================================
-- Evaluation dashboard (phase 1) — conciseness + copy-detection scoring
--
-- Adds two deterministic, non-AI score columns to evaluations
-- (conciseness_score, copy_similarity_score — see backend/app/services/
-- text_metrics.py) and their per-topic averages to progress_snapshots.
-- Neither is PII, so both are plain (unencrypted) numeric columns, same
-- treatment as mouse_activity_count/option_hover_count in
-- add_mcq_and_behaviour_columns.sql.
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- security_hardening.sql, decrypted_view_writes_and_rpc.sql, and
-- add_mcq_and_behaviour_columns.sql have already been applied.
-- =============================================================

SET search_path = aied, public, extensions;


-- =============================================================
-- 1. evaluations / progress_snapshots — new plain columns
-- =============================================================
ALTER TABLE aied.evaluations ADD COLUMN IF NOT EXISTS conciseness_score numeric(5,2);
ALTER TABLE aied.evaluations ADD COLUMN IF NOT EXISTS copy_similarity_score numeric(5,2);

ALTER TABLE aied.progress_snapshots ADD COLUMN IF NOT EXISTS avg_conciseness numeric(5,2);
ALTER TABLE aied.progress_snapshots ADD COLUMN IF NOT EXISTS avg_copy_similarity numeric(5,2);


-- =============================================================
-- 2. evaluations_decrypted — add new columns to the read view
-- (appended at the end; CREATE OR REPLACE VIEW can't reorder or remove
-- existing output columns)
-- =============================================================
CREATE OR REPLACE VIEW aied.evaluations_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    answer_id,
    question_id,
    session_id,
    user_id,
    factual_correctness_score,
    structure_score,
    accuracy_score,
    precision_score,
    recall_score,
    wording_score,
    raw_score,
    time_modifier,
    final_score,
    pgp_sym_decrypt(concepts_covered, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii'))::jsonb AS concepts_covered,
    pgp_sym_decrypt(concepts_missed,  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii'))::jsonb AS concepts_missed,
    pgp_sym_decrypt(feedback_text,    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii')) AS feedback_text,
    hallucination_flag,
    CASE WHEN hallucination_note IS NOT NULL THEN
        pgp_sym_decrypt(hallucination_note, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii'))
    END AS hallucination_note,
    evaluator_model,
    evaluation_temperature,
    evaluation_top_p,
    checker_model,
    created_at,
    conciseness_score,
    copy_similarity_score
FROM aied.evaluations;


-- =============================================================
-- 3. evaluations_decrypted_insert() — pass the two new columns through
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
        checker_model, created_at,
        conciseness_score, copy_similarity_score
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
        NEW.checker_model, v_created_at,
        NEW.conciseness_score, NEW.copy_similarity_score
    );
    NEW.id := v_id;
    NEW.created_at := v_created_at;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

-- Trigger definition itself is unchanged (same function name, same view) —
-- CREATE OR REPLACE FUNCTION above is sufficient, no need to redrop/recreate it.


-- =============================================================
-- 4. progress_snapshots_decrypted — add new columns to the read view
-- =============================================================
CREATE OR REPLACE VIEW aied.progress_snapshots_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    user_id,
    topic_id,
    snapshot_date,
    avg_factual_correctness,
    avg_structure,
    avg_accuracy,
    avg_precision,
    avg_recall,
    avg_wording,
    avg_raw_score,
    avg_final_score,
    avg_time_modifier,
    CASE WHEN dominant_behaviour IS NOT NULL THEN
        pgp_sym_decrypt(dominant_behaviour, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii'))
    END AS dominant_behaviour,
    questions_attempted,
    sessions_completed,
    goal_proximity,
    avg_conciseness,
    avg_copy_similarity
FROM aied.progress_snapshots;


-- =============================================================
-- 5. progress_snapshots_decrypted_insert() — pass the two new columns
-- through on both insert and the upsert path
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
        dominant_behaviour, questions_attempted, sessions_completed, goal_proximity,
        avg_conciseness, avg_copy_similarity
    ) VALUES (
        v_id, NEW.user_id, NEW.topic_id, COALESCE(NEW.snapshot_date, CURRENT_DATE),
        NEW.avg_factual_correctness, NEW.avg_structure, NEW.avg_accuracy,
        NEW.avg_precision, NEW.avg_recall, NEW.avg_wording,
        NEW.avg_raw_score, NEW.avg_final_score, NEW.avg_time_modifier,
        CASE WHEN NEW.dominant_behaviour IS NOT NULL THEN pgp_sym_encrypt(NEW.dominant_behaviour, v_key) END,
        NEW.questions_attempted, NEW.sessions_completed, NEW.goal_proximity,
        NEW.avg_conciseness, NEW.avg_copy_similarity
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
        sessions_completed = EXCLUDED.sessions_completed,
        avg_conciseness = EXCLUDED.avg_conciseness,
        avg_copy_similarity = EXCLUDED.avg_copy_similarity
    RETURNING id INTO v_id;

    NEW.id := v_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;


-- =============================================================
-- 6. topic_progress_stats() RPC — add avg_conciseness/avg_copy_similarity
-- to both the return shape and the underlying aggregate query
--
-- CREATE OR REPLACE FUNCTION cannot change a function's return type in
-- Postgres, and adding columns to RETURNS TABLE(...) counts as changing it
-- — must DROP first (this also drops its grants, re-applied below).
-- =============================================================
DROP FUNCTION IF EXISTS aied.topic_progress_stats(uuid, uuid, uuid);

CREATE FUNCTION aied.topic_progress_stats(
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
    sessions_completed bigint,
    avg_conciseness numeric,
    avg_copy_similarity numeric
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
        ) AS sessions_completed,
        stats.avg_conciseness,
        stats.avg_copy_similarity
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
          COUNT(*)                         AS questions_attempted,
          AVG(e.conciseness_score)         AS avg_conciseness,
          AVG(e.copy_similarity_score)     AS avg_copy_similarity
        FROM aied.evaluations e
        JOIN aied.questions q ON e.question_id = q.id
        WHERE q.session_id = p_session_id AND q.topic_id = p_topic_id
    ) stats;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = aied, vault, extensions;

-- The DROP FUNCTION above removed the grant from decrypted_view_writes_and_rpc.sql
-- along with the old function — must re-apply it against the new signature.
GRANT EXECUTE ON FUNCTION aied.topic_progress_stats(uuid, uuid, uuid) TO service_role;
