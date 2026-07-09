-- =============================================================
-- AIEDv2 — Frakture AI Education Platform
-- Supabase / PostgreSQL schema  (v2 — column-level encryption)
-- Run this ONCE in the Supabase SQL editor before first use.
-- =============================================================

-- Schema must exist before setting search_path
CREATE SCHEMA IF NOT EXISTS aied;
SET search_path TO aied, public, extensions;

-- Extensions (explicit schema so they land in extensions, not aied)
CREATE EXTENSION IF NOT EXISTS vector   SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- IMPORTANT: Before running this script, create the encryption key in Vault ONCE:
--
--   SELECT vault.create_secret(
--     encode(gen_random_bytes(32), 'hex'),
--     'student_pii',
--     'Encryption key for student PII columns'
--   );
--
-- Run that line in the SQL editor first, then run the rest of this file.
-- Never run it again — rotating the key makes all existing encrypted data unreadable.


-- =============================================================
-- 1. topics
-- =============================================================
CREATE TABLE topics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(255) NOT NULL UNIQUE,
    parent_id   UUID REFERENCES topics(id) ON DELETE SET NULL,
    level       INT NOT NULL DEFAULT 0,
    description TEXT
);

CREATE INDEX idx_topics_parent ON topics(parent_id);


-- =============================================================
-- 2. users
-- =============================================================
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  VARCHAR(50)  NOT NULL,
    email_hash    VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL DEFAULT '',
    entra_id      VARCHAR(255) NOT NULL DEFAULT '',
    role          VARCHAR(20)  NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_active   TIMESTAMPTZ,
    is_active     BOOLEAN      NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX idx_users_email_hash ON users(email_hash) WHERE email_hash <> '';
CREATE UNIQUE INDEX idx_users_entra_id   ON users(entra_id)   WHERE entra_id  <> '';


-- =============================================================
-- 3. user_consents  (append-only audit log)
-- =============================================================
CREATE TABLE user_consents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consent_type        VARCHAR(100) NOT NULL CHECK (consent_type IN ('terms_and_conditions', 'behavioural_tracking', 'data_retention')),
    policy_version      VARCHAR(20)  NOT NULL,
    section_reference   VARCHAR(50)  NOT NULL,
    consented_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    consent_method      VARCHAR(50)  NOT NULL CHECK (consent_method IN ('signup_checkbox', 'banner_dismissed', 'explicit_confirm')),
    ip_hash             VARCHAR(255),
    banner_dismissed    BOOLEAN,
    banner_dismissed_at TIMESTAMPTZ
);

CREATE INDEX idx_user_consents_user ON user_consents(user_id);


-- =============================================================
-- 4. student_profiles  (one-to-one with users)
-- PII: target_exam encrypted — reveals academic context.
-- =============================================================
CREATE TABLE student_profiles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_exam          BYTEA,        -- encrypted: student's target exam name
    target_date          DATE,
    study_hours_per_week INT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================
-- 5. student_goals
-- PII: goal_text and goal_structured encrypted.
-- =============================================================
CREATE TABLE student_goals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    goal_text       BYTEA       NOT NULL,   -- encrypted: student-written goal summary
    goal_structured BYTEA,                 -- encrypted: structured goal JSON
    topic_id        UUID        REFERENCES topics(id) ON DELETE SET NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'deleted')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_goals_user   ON student_goals(user_id);
CREATE INDEX idx_student_goals_topic  ON student_goals(topic_id);
CREATE INDEX idx_student_goals_status ON student_goals(user_id, status);


-- =============================================================
-- 6. goal_chat_history  (append-only)
-- PII: content encrypted — full chatbot conversation.
-- =============================================================
CREATE TABLE goal_chat_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content    BYTEA       NOT NULL,   -- encrypted: message text
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_goal_chat_user ON goal_chat_history(user_id, created_at);


-- =============================================================
-- 7. documents
-- =============================================================
CREATE TABLE documents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title            VARCHAR(500) NOT NULL,
    author           VARCHAR(255),
    document_type    VARCHAR(50)  NOT NULL CHECK (document_type IN ('textbook', 'past_paper', 'notes')),
    difficulty       VARCHAR(20)  NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    storage_key      VARCHAR(500) NOT NULL,
    total_pages      INT,
    total_chunks     INT,
    ingestion_status VARCHAR(50)  NOT NULL DEFAULT 'pending' CHECK (ingestion_status IN ('pending', 'processing', 'complete', 'failed')),
    uploaded_by      UUID         NOT NULL REFERENCES users(id),
    uploaded_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    topic_id         UUID         REFERENCES topics(id) ON DELETE SET NULL
);

CREATE INDEX idx_documents_topic  ON documents(topic_id);
CREATE INDEX idx_documents_status ON documents(ingestion_status);


-- =============================================================
-- 8. user_documents  (access tracking)
-- =============================================================
CREATE TABLE user_documents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    document_id        UUID        NOT NULL REFERENCES documents(id)    ON DELETE CASCADE,
    first_accessed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_count       INT         NOT NULL DEFAULT 1,
    downloaded         BOOLEAN     NOT NULL DEFAULT false,
    download_count     INT         NOT NULL DEFAULT 0,
    last_downloaded_at TIMESTAMPTZ,
    UNIQUE (user_id, document_id)
);

CREATE INDEX idx_user_documents_user ON user_documents(user_id);


-- =============================================================
-- 9. document_chunks
-- =============================================================
CREATE TABLE document_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    topic_id    UUID        REFERENCES topics(id) ON DELETE SET NULL,
    chunk_index INT         NOT NULL,
    content     TEXT        NOT NULL,
    page_start  INT,
    page_end    INT,
    chapter     VARCHAR(255),
    section     VARCHAR(255),
    difficulty  VARCHAR(20) CHECK (difficulty IN ('easy', 'medium', 'hard')),
    embedding   VECTOR(768),
    fts_vector  TSVECTOR,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chunks_embedding ON document_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_chunks_fts      ON document_chunks USING gin(fts_vector);
CREATE INDEX idx_chunks_document ON document_chunks(document_id, difficulty);
CREATE INDEX idx_chunks_topic    ON document_chunks(topic_id);

CREATE OR REPLACE FUNCTION chunks_fts_update() RETURNS trigger AS $$
BEGIN
    NEW.fts_vector := to_tsvector('english', NEW.content);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chunks_fts
    BEFORE INSERT OR UPDATE OF content
    ON document_chunks
    FOR EACH ROW EXECUTE FUNCTION chunks_fts_update();


-- =============================================================
-- 10. test_sessions
-- =============================================================
CREATE TABLE test_sessions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID         NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    difficulty             VARCHAR(20)  NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'mixed')),
    total_questions        INT          NOT NULL,
    status                 VARCHAR(20)  NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    overall_score          NUMERIC(5,2),
    generation_temperature NUMERIC(3,2),
    generation_top_p       NUMERIC(3,2),
    retrieval_top_k        INT,
    started_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at           TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user  ON test_sessions(user_id);


-- =============================================================
-- 10b. session_topics  (many-to-many: a session can span multiple topics)
-- =============================================================
CREATE TABLE session_topics (
    session_id UUID NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    topic_id   UUID NOT NULL REFERENCES topics(id),
    PRIMARY KEY (session_id, topic_id)
);

CREATE INDEX idx_session_topics_topic ON session_topics(topic_id);


-- =============================================================
-- 11. questions
-- =============================================================
CREATE TABLE questions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id            UUID         NOT NULL REFERENCES test_sessions(id)   ON DELETE CASCADE,
    chunk_id              UUID         NOT NULL REFERENCES document_chunks(id),
    topic_id              UUID         REFERENCES topics(id) ON DELETE SET NULL,
    question_text         TEXT         NOT NULL,
    question_type         VARCHAR(50)  NOT NULL CHECK (question_type IN ('short_answer', 'long_answer', 'mcq')),
    difficulty            VARCHAR(20)  NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    expected_concepts     JSONB        NOT NULL DEFAULT '[]',
    expected_time_seconds INT          NOT NULL,
    citation_book         VARCHAR(500),
    citation_author       VARCHAR(255),
    citation_chapter      VARCHAR(255),
    citation_page_start   INT,
    citation_page_end     INT,
    model_used            VARCHAR(100),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_questions_session ON questions(session_id);
CREATE INDEX idx_questions_chunk   ON questions(chunk_id);


-- =============================================================
-- 12. answers
-- PII: answer_text encrypted — student's written exam response.
-- =============================================================
CREATE TABLE answers (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id  UUID        NOT NULL REFERENCES questions(id)     ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    session_id   UUID        NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    answer_text  BYTEA       NOT NULL,   -- encrypted: student's written answer
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_answers_question ON answers(question_id);
CREATE INDEX idx_answers_session  ON answers(session_id);
CREATE INDEX idx_answers_user     ON answers(user_id);


-- =============================================================
-- 13. question_events  (TTL 30 days, append-only)
-- =============================================================
CREATE TABLE question_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    answer_id   UUID        NOT NULL REFERENCES answers(id)       ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    question_id UUID        NOT NULL REFERENCES questions(id)     ON DELETE CASCADE,
    session_id  UUID        NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    event_type  VARCHAR(50) NOT NULL CHECK (event_type IN ('focus', 'blur', 'keystroke_start', 'edit', 'submit')),
    event_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_events_answer  ON question_events(answer_id);
CREATE INDEX idx_events_expires ON question_events(expires_at);


-- =============================================================
-- 14. answer_behaviour  (one-to-one with answers)
-- PII: behaviour_label encrypted — inferred student psychological state.
-- Numeric metrics left as-is (needed for scoring computation).
-- =============================================================
CREATE TABLE answer_behaviour (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    answer_id                  UUID UNIQUE  NOT NULL REFERENCES answers(id)       ON DELETE CASCADE,
    user_id                    UUID         NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    question_id                UUID         NOT NULL REFERENCES questions(id)     ON DELETE CASCADE,
    session_id                 UUID         NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    active_time_seconds        INT          NOT NULL,
    total_elapsed_seconds      INT          NOT NULL,
    pause_count                INT          NOT NULL DEFAULT 0,
    distraction_ratio          NUMERIC(4,3) NOT NULL,
    answer_start_delay_seconds INT          NOT NULL DEFAULT 0,
    revision_count             INT          NOT NULL DEFAULT 0,
    behaviour_label            BYTEA        NOT NULL,   -- encrypted: confident/struggling/distracted/guessing/neutral
    time_modifier              NUMERIC(4,3) NOT NULL
);

CREATE INDEX idx_behaviour_session ON answer_behaviour(session_id);


-- =============================================================
-- 15. evaluations  (one-to-one with answers)
-- PII: feedback_text, concepts_covered, concepts_missed, hallucination_note encrypted.
-- Numeric scores left as-is (needed for aggregation in progress_snapshots).
-- =============================================================
CREATE TABLE evaluations (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    answer_id                 UUID UNIQUE  NOT NULL REFERENCES answers(id)       ON DELETE CASCADE,
    question_id               UUID         NOT NULL REFERENCES questions(id)     ON DELETE CASCADE,
    session_id                UUID         NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    user_id                   UUID         NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    factual_correctness_score NUMERIC(5,2) NOT NULL,
    structure_score           NUMERIC(5,2) NOT NULL,
    accuracy_score            NUMERIC(5,2) NOT NULL,
    precision_score           NUMERIC(5,2) NOT NULL,
    recall_score              NUMERIC(5,2) NOT NULL,
    wording_score             NUMERIC(5,2) NOT NULL,
    raw_score                 NUMERIC(5,2) NOT NULL,
    time_modifier             NUMERIC(4,3) NOT NULL,
    final_score               NUMERIC(5,2) NOT NULL,
    concepts_covered          BYTEA        NOT NULL,   -- encrypted: JSON array of covered concepts
    concepts_missed           BYTEA        NOT NULL,   -- encrypted: JSON array of missed concepts
    feedback_text             BYTEA        NOT NULL,   -- encrypted: personalized AI feedback
    hallucination_flag        BOOLEAN      NOT NULL DEFAULT false,
    hallucination_note        BYTEA,                   -- encrypted: verification finding details
    evaluator_model           VARCHAR(100),
    evaluation_temperature    NUMERIC(3,2),
    evaluation_top_p          NUMERIC(3,2),
    checker_model             VARCHAR(100),
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_evaluations_session ON evaluations(session_id);
CREATE INDEX idx_evaluations_user    ON evaluations(user_id);


-- =============================================================
-- 16. recommendations
-- PII: reason encrypted — personalised recommendation rationale.
-- =============================================================
CREATE TABLE recommendations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
    session_id UUID        NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
    chunk_id   UUID        NOT NULL REFERENCES document_chunks(id),
    topic_id   UUID        NOT NULL REFERENCES topics(id),
    reason     BYTEA       NOT NULL,   -- encrypted: personalised reason text
    priority   INT         NOT NULL DEFAULT 1,
    viewed     BOOLEAN     NOT NULL DEFAULT false,
    viewed_at  TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_recommendations_user    ON recommendations(user_id, viewed);
CREATE INDEX idx_recommendations_session ON recommendations(session_id);


-- =============================================================
-- 17. progress_snapshots
-- PII: dominant_behaviour encrypted.
-- Numeric averages left as-is (needed for dashboard aggregation).
-- =============================================================
CREATE TABLE progress_snapshots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID         NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    topic_id                UUID         NOT NULL REFERENCES topics(id),
    snapshot_date           DATE         NOT NULL,
    avg_factual_correctness NUMERIC(5,2),
    avg_structure           NUMERIC(5,2),
    avg_accuracy            NUMERIC(5,2),
    avg_precision           NUMERIC(5,2),
    avg_recall              NUMERIC(5,2),
    avg_wording             NUMERIC(5,2),
    avg_raw_score           NUMERIC(5,2),
    avg_final_score         NUMERIC(5,2),
    avg_time_modifier       NUMERIC(4,3),
    dominant_behaviour      BYTEA,                   -- encrypted: aggregated behaviour label
    questions_attempted     INT          NOT NULL DEFAULT 0,
    sessions_completed      INT          NOT NULL DEFAULT 0,
    goal_proximity          NUMERIC(5,2),
    UNIQUE (user_id, topic_id, snapshot_date)
);

CREATE INDEX idx_progress_user ON progress_snapshots(user_id, snapshot_date DESC);


-- =============================================================
-- ROW LEVEL SECURITY
-- The `aied` schema is exposed to the Data API, but the app never talks
-- to Postgres through PostgREST — it uses asyncpg with the `postgres`
-- role (bypasses RLS) for all reads/writes, and supabase-py only for
-- Storage. RLS is enabled with no policies on every table, so anon/
-- authenticated get zero rows via the API by default. All authorization
-- happens in the FastAPI layer, not here.
-- =============================================================
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
ALTER TABLE session_topics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_behaviour     ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_snapshots   ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- DECRYPTION VIEWS
-- The application always reads from these views, never base tables.
-- The key id is resolved once per query from pgsodium.valid_key.
-- security_invoker = true: the view enforces RLS/permissions of the
-- querying role instead of the view owner. The backend's `postgres`
-- role already has vault decrypt access, so this doesn't affect the
-- app; it just stops the view from bypassing RLS for anon/authenticated.
-- =============================================================

CREATE VIEW student_profiles_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    user_id,
    CASE WHEN target_exam IS NOT NULL THEN
        pgp_sym_decrypt(target_exam, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii'))
    END AS target_exam,
    target_date,
    study_hours_per_week,
    updated_at
FROM student_profiles;


CREATE VIEW student_goals_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    user_id,
    pgp_sym_decrypt(goal_text, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii')) AS goal_text,
    CASE WHEN goal_structured IS NOT NULL THEN
        pgp_sym_decrypt(goal_structured, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii'))::jsonb
    END AS goal_structured,
    topic_id,
    status,
    created_at,
    updated_at
FROM student_goals;


CREATE VIEW goal_chat_history_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    user_id,
    role,
    pgp_sym_decrypt(content, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii')) AS content,
    created_at
FROM goal_chat_history;


CREATE VIEW answers_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    question_id,
    user_id,
    session_id,
    pgp_sym_decrypt(answer_text, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii')) AS answer_text,
    submitted_at
FROM answers;


CREATE VIEW answer_behaviour_decrypted WITH (security_invoker = true) AS
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
    time_modifier
FROM answer_behaviour;


CREATE VIEW evaluations_decrypted WITH (security_invoker = true) AS
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
    created_at
FROM evaluations;


CREATE VIEW recommendations_decrypted WITH (security_invoker = true) AS
SELECT
    id,
    user_id,
    session_id,
    chunk_id,
    topic_id,
    pgp_sym_decrypt(reason, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii')) AS reason,
    priority,
    viewed,
    viewed_at,
    created_at
FROM recommendations;


CREATE VIEW progress_snapshots_decrypted WITH (security_invoker = true) AS
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
    goal_proximity
FROM progress_snapshots;


-- =============================================================
-- PERMISSIONS
-- anon role intentionally gets no access to decrypted views.
-- =============================================================
GRANT SELECT ON aied.student_profiles_decrypted   TO service_role, authenticated;
GRANT SELECT ON aied.student_goals_decrypted       TO service_role, authenticated;
GRANT SELECT ON aied.goal_chat_history_decrypted   TO service_role, authenticated;
GRANT SELECT ON aied.answers_decrypted             TO service_role, authenticated;
GRANT SELECT ON aied.answer_behaviour_decrypted    TO service_role, authenticated;
GRANT SELECT ON aied.evaluations_decrypted         TO service_role, authenticated;
GRANT SELECT ON aied.recommendations_decrypted     TO service_role, authenticated;
GRANT SELECT ON aied.progress_snapshots_decrypted  TO service_role, authenticated;


-- =============================================================
-- TTL cleanup (scheduled via Supabase pg_cron or Edge Function)
-- =============================================================
-- SELECT cron.schedule('ttl-question-events', '0 3 * * *',
--   $$DELETE FROM question_events WHERE expires_at < now()$$);
