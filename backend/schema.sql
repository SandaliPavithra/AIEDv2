-- ============================================================
-- AI Education Platform — Database Schema
-- Run against your Supabase project (SQL Editor or psql)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1. users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name  varchar(50)  NOT NULL,
    email_hash    varchar(255) NOT NULL UNIQUE,
    password_hash varchar(255) NOT NULL,
    entra_id      varchar(255),
    role          varchar(20)  NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
    created_at    timestamptz  NOT NULL DEFAULT now(),
    last_active   timestamptz,
    is_active     boolean      NOT NULL DEFAULT true
);

-- ============================================================
-- 2. user_consents
-- ============================================================
CREATE TABLE IF NOT EXISTS user_consents (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid         NOT NULL REFERENCES users(id),
    consent_type     varchar(100) NOT NULL,
    policy_version   varchar(20)  NOT NULL,
    section_reference varchar(50),
    consented_at     timestamptz  NOT NULL DEFAULT now(),
    consent_method   varchar(50)  NOT NULL,
    ip_hash          varchar(255),
    banner_dismissed boolean      NOT NULL DEFAULT false,
    banner_dismissed_at timestamptz
);

-- ============================================================
-- 3. student_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS student_profiles (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES users(id) UNIQUE,
    target_exam           varchar(255),
    target_date           date,
    study_hours_per_week  int,
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. topics  (declared before tables that FK into it)
-- ============================================================
CREATE TABLE IF NOT EXISTS topics (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(255) NOT NULL,
    slug        varchar(255) NOT NULL UNIQUE,
    parent_id   uuid REFERENCES topics(id),
    level       int          NOT NULL DEFAULT 0,
    description text
);

-- ============================================================
-- 4. student_goals
-- ============================================================
CREATE TABLE IF NOT EXISTS student_goals (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL REFERENCES users(id),
    goal_text        text        NOT NULL,
    goal_structured  jsonb,
    topic_id         uuid        REFERENCES topics(id),
    status           varchar(20) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'completed', 'deleted')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. goal_chat_history
-- ============================================================
CREATE TABLE IF NOT EXISTS goal_chat_history (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id),
    role       varchar(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content    text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. documents
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title            varchar(500) NOT NULL,
    author           varchar(255),
    document_type    varchar(50)  NOT NULL CHECK (document_type IN ('textbook', 'past_paper', 'notes')),
    difficulty       varchar(20)  NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    storage_key      varchar(500) NOT NULL,
    total_pages      int,
    total_chunks     int,
    ingestion_status varchar(50)  NOT NULL DEFAULT 'pending'
                         CHECK (ingestion_status IN ('pending', 'processing', 'complete', 'failed')),
    uploaded_by      uuid         NOT NULL REFERENCES users(id),
    uploaded_at      timestamptz  NOT NULL DEFAULT now(),
    topic_id         uuid         REFERENCES topics(id)
);

-- ============================================================
-- 8. user_documents
-- ============================================================
CREATE TABLE IF NOT EXISTS user_documents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES users(id),
    document_id       uuid        NOT NULL REFERENCES documents(id),
    first_accessed_at timestamptz NOT NULL DEFAULT now(),
    last_accessed_at  timestamptz NOT NULL DEFAULT now(),
    access_count      int         NOT NULL DEFAULT 1,
    downloaded        boolean     NOT NULL DEFAULT false,
    download_count    int         NOT NULL DEFAULT 0,
    last_downloaded_at timestamptz,
    CONSTRAINT uq_user_document UNIQUE (user_id, document_id)
);

-- ============================================================
-- 9. document_chunks
-- ============================================================
CREATE TABLE IF NOT EXISTS document_chunks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid        NOT NULL REFERENCES documents(id),
    topic_id    uuid        REFERENCES topics(id),
    chunk_index int         NOT NULL,
    content     text        NOT NULL,
    page_start  int,
    page_end    int,
    chapter     varchar(255),
    section     varchar(255),
    difficulty  varchar(20) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    embedding   vector(768),
    fts_vector  tsvector,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- FTS auto-update trigger
CREATE OR REPLACE FUNCTION update_chunk_fts_fn()
RETURNS trigger AS $$
BEGIN
    NEW.fts_vector := to_tsvector('pg_catalog.english', COALESCE(NEW.content, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_chunk_fts ON document_chunks;
CREATE TRIGGER update_chunk_fts
BEFORE INSERT OR UPDATE OF content ON document_chunks
FOR EACH ROW EXECUTE FUNCTION update_chunk_fts_fn();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_chunks_fts
    ON document_chunks USING GIN (fts_vector);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_diff
    ON document_chunks (document_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_chunks_topic
    ON document_chunks (topic_id);

-- ============================================================
-- 10. test_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS test_sessions (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid           NOT NULL REFERENCES users(id),
    topic_id                uuid           REFERENCES topics(id),
    difficulty              varchar(20)    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'mixed')),
    total_questions         int            NOT NULL DEFAULT 0,
    status                  varchar(20)    NOT NULL DEFAULT 'in_progress'
                                CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    overall_score           numeric(5, 2),
    generation_temperature  numeric(3, 2),
    generation_top_p        numeric(3, 2),
    retrieval_top_k         int,
    started_at              timestamptz    NOT NULL DEFAULT now(),
    completed_at            timestamptz
);

-- ============================================================
-- 11. questions
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid         NOT NULL REFERENCES test_sessions(id),
    chunk_id            uuid         REFERENCES document_chunks(id),
    topic_id            uuid         REFERENCES topics(id),
    question_text       text         NOT NULL,
    question_type       varchar(50)  NOT NULL CHECK (question_type IN ('short_answer', 'long_answer', 'mcq')),
    difficulty          varchar(20)  NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'mixed')),
    expected_concepts   jsonb,
    expected_time_seconds int,
    citation_book       varchar(500),
    citation_author     varchar(255),
    citation_chapter    varchar(255),
    citation_page_start int,
    citation_page_end   int,
    model_used          varchar(100),
    created_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questions_session ON questions (session_id);

-- ============================================================
-- 12. answers
-- ============================================================
CREATE TABLE IF NOT EXISTS answers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id  uuid        NOT NULL REFERENCES questions(id),
    user_id      uuid        NOT NULL REFERENCES users(id),
    session_id   uuid        NOT NULL REFERENCES test_sessions(id),
    answer_text  text        NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 13. question_events  (30-day TTL)
-- ============================================================
CREATE TABLE IF NOT EXISTS question_events (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    answer_id   uuid        NOT NULL REFERENCES answers(id),
    user_id     uuid        NOT NULL REFERENCES users(id),
    question_id uuid        NOT NULL REFERENCES questions(id),
    session_id  uuid        NOT NULL REFERENCES test_sessions(id),
    event_type  varchar(50) NOT NULL
                    CHECK (event_type IN ('focus', 'blur', 'keystroke_start', 'edit', 'submit')),
    event_at    timestamptz NOT NULL,
    expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_expires ON question_events (expires_at);
CREATE INDEX IF NOT EXISTS idx_events_answer  ON question_events (answer_id);

-- ============================================================
-- 14. answer_behaviour
-- ============================================================
CREATE TABLE IF NOT EXISTS answer_behaviour (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    answer_id                   uuid           NOT NULL REFERENCES answers(id) UNIQUE,
    user_id                     uuid           NOT NULL REFERENCES users(id),
    question_id                 uuid           NOT NULL REFERENCES questions(id),
    session_id                  uuid           NOT NULL REFERENCES test_sessions(id),
    active_time_seconds         int            NOT NULL DEFAULT 0,
    total_elapsed_seconds       int            NOT NULL DEFAULT 0,
    pause_count                 int            NOT NULL DEFAULT 0,
    distraction_ratio           numeric(4, 3)  NOT NULL DEFAULT 0,
    answer_start_delay_seconds  int            NOT NULL DEFAULT 0,
    revision_count              int            NOT NULL DEFAULT 0,
    behaviour_label             varchar(20)    NOT NULL DEFAULT 'neutral'
                                    CHECK (behaviour_label IN ('confident', 'struggling', 'distracted', 'guessing', 'neutral')),
    time_modifier               numeric(4, 3)  NOT NULL DEFAULT 1.0
);

-- ============================================================
-- 15. evaluations
-- ============================================================
CREATE TABLE IF NOT EXISTS evaluations (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    answer_id                uuid           NOT NULL REFERENCES answers(id) UNIQUE,
    question_id              uuid           NOT NULL REFERENCES questions(id),
    session_id               uuid           NOT NULL REFERENCES test_sessions(id),
    user_id                  uuid           NOT NULL REFERENCES users(id),
    factual_correctness_score numeric(5, 2)  NOT NULL,
    structure_score           numeric(5, 2)  NOT NULL,
    accuracy_score            numeric(5, 2)  NOT NULL,
    precision_score           numeric(5, 2)  NOT NULL,
    recall_score              numeric(5, 2)  NOT NULL,
    wording_score             numeric(5, 2)  NOT NULL,
    raw_score                 numeric(5, 2)  NOT NULL,
    time_modifier             numeric(4, 3)  NOT NULL,
    final_score               numeric(5, 2)  NOT NULL,
    concepts_covered          jsonb,
    concepts_missed           jsonb,
    feedback_text             text,
    hallucination_flag        boolean        NOT NULL DEFAULT false,
    hallucination_note        text,
    evaluator_model           varchar(100),
    evaluation_temperature    numeric(3, 2),
    evaluation_top_p          numeric(3, 2),
    checker_model             varchar(100),
    created_at                timestamptz    NOT NULL DEFAULT now()
);

-- ============================================================
-- 16. recommendations
-- ============================================================
CREATE TABLE IF NOT EXISTS recommendations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id),
    session_id uuid        NOT NULL REFERENCES test_sessions(id),
    chunk_id   uuid        NOT NULL REFERENCES document_chunks(id),
    topic_id   uuid        REFERENCES topics(id),
    reason     text,
    priority   int         NOT NULL DEFAULT 1,
    viewed     boolean     NOT NULL DEFAULT false,
    viewed_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 17. progress_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS progress_snapshots (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid          NOT NULL REFERENCES users(id),
    topic_id              uuid          NOT NULL REFERENCES topics(id),
    snapshot_date         date          NOT NULL,
    avg_factual_correctness numeric(5,2),
    avg_structure           numeric(5,2),
    avg_accuracy            numeric(5,2),
    avg_precision           numeric(5,2),
    avg_recall              numeric(5,2),
    avg_wording             numeric(5,2),
    avg_raw_score           numeric(5,2),
    avg_final_score         numeric(5,2),
    avg_time_modifier       numeric(4,3),
    dominant_behaviour      varchar(20),
    questions_attempted     int          NOT NULL DEFAULT 0,
    sessions_completed      int          NOT NULL DEFAULT 0,
    goal_proximity          numeric(5,2),
    CONSTRAINT uq_progress_snapshot UNIQUE (user_id, topic_id, snapshot_date)
);

-- ============================================================
-- Nightly cleanup: remove expired question_events
-- Run this via a Supabase Edge Function cron or pg_cron:
--   DELETE FROM question_events WHERE expires_at < now();
-- ============================================================
