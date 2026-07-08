-- =============================================================
-- Generation/Quiz dashboard — schema additions
--
-- Adds MCQ support (options + correct_index on questions) and two new
-- behaviour telemetry counters (mouse_activity_count, option_hover_count
-- on answer_behaviour), plus the new question_events types those counters
-- are derived from.
--
-- Run this once in the Supabase SQL editor, after schema.sql,
-- security_hardening.sql, and decrypted_view_writes_and_rpc.sql have
-- already been applied.
-- =============================================================

SET search_path = aied, public, extensions;


-- =============================================================
-- 1. questions — MCQ options + answer key
-- correct_index is only ever read by RPC/service code (Evaluation phase),
-- never by the quiz-facing endpoint — see get_session_questions in
-- sessions.py, which explicitly excludes it from its select list.
-- =============================================================
ALTER TABLE aied.questions ADD COLUMN IF NOT EXISTS options jsonb;
ALTER TABLE aied.questions ADD COLUMN IF NOT EXISTS correct_index int;


-- =============================================================
-- 2. answer_behaviour — new telemetry counters
-- =============================================================
ALTER TABLE aied.answer_behaviour ADD COLUMN IF NOT EXISTS mouse_activity_count int NOT NULL DEFAULT 0;
ALTER TABLE aied.answer_behaviour ADD COLUMN IF NOT EXISTS option_hover_count int NOT NULL DEFAULT 0;


-- =============================================================
-- 3. question_events — new event types
-- Inline CHECK constraints get Postgres's default
-- "<table>_<column>_check" name, so this matches what schema.sql created.
-- =============================================================
ALTER TABLE aied.question_events DROP CONSTRAINT IF EXISTS question_events_event_type_check;
ALTER TABLE aied.question_events ADD CONSTRAINT question_events_event_type_check
    CHECK (event_type IN (
        'focus', 'blur', 'keystroke_start', 'edit', 'submit',
        'mouse_activity', 'option_hover_start', 'option_hover_end'
    ));


-- =============================================================
-- 4. answer_behaviour_decrypted — add new columns to the read view
-- (new columns must be appended at the end; CREATE OR REPLACE VIEW can't
-- reorder or remove existing output columns)
-- =============================================================
CREATE OR REPLACE VIEW aied.answer_behaviour_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    answer_id,
    user_id,
    question_id,
    session_id,
    active_time_seconds,
    total_elapsed_seconds,
    pause_count,
    distraction_ratio,
    answer_start_delay_seconds,
    revision_count,
    pgp_sym_decrypt(behaviour_label, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii')) AS behaviour_label,
    time_modifier,
    mouse_activity_count,
    option_hover_count
FROM aied.answer_behaviour;


-- =============================================================
-- 5. answer_behaviour_decrypted_insert() — pass the two new plain
-- (non-encrypted) columns through on both insert and the upsert path.
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
       behaviour_label, time_modifier, mouse_activity_count, option_hover_count)
    VALUES (
        v_id, NEW.answer_id, NEW.user_id, NEW.question_id, NEW.session_id,
        NEW.active_time_seconds, NEW.total_elapsed_seconds, NEW.pause_count,
        NEW.distraction_ratio, NEW.answer_start_delay_seconds, NEW.revision_count,
        pgp_sym_encrypt(NEW.behaviour_label, v_key), NEW.time_modifier,
        COALESCE(NEW.mouse_activity_count, 0), COALESCE(NEW.option_hover_count, 0)
    )
    ON CONFLICT (answer_id) DO UPDATE SET
        active_time_seconds = EXCLUDED.active_time_seconds,
        total_elapsed_seconds = EXCLUDED.total_elapsed_seconds,
        pause_count = EXCLUDED.pause_count,
        distraction_ratio = EXCLUDED.distraction_ratio,
        answer_start_delay_seconds = EXCLUDED.answer_start_delay_seconds,
        revision_count = EXCLUDED.revision_count,
        behaviour_label = EXCLUDED.behaviour_label,
        time_modifier = EXCLUDED.time_modifier,
        mouse_activity_count = EXCLUDED.mouse_activity_count,
        option_hover_count = EXCLUDED.option_hover_count
    RETURNING id INTO v_id;

    NEW.id := v_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = aied, vault, extensions;

-- Trigger definition itself is unchanged (same function name, same view) —
-- CREATE OR REPLACE FUNCTION above is sufficient, no need to redrop/recreate it.
