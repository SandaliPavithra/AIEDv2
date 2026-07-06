# Generation (Quiz) Dashboard — Design

**Date:** 2026-07-06
**Status:** Approved — first of three sub-projects (Generation → Evaluation → Recommendations)

## Context

AIEDv2 needs three student-facing dashboards, one per pillar of the product name ("AI in Education for **E**valuation, **R**ecommendation and **G**eneration"): a quiz-taking flow (Generation), an AI grading/feedback flow (Evaluation), and a recommended-reading flow (Recommendations). They're built as three separate, independently-navigable pages, but built **in dependency order** — Evaluation needs answers + behavior data that only exist after a quiz is taken; Recommendations need `concepts_missed` output that only exists after evaluation runs. This spec covers **Generation only**.

Generation is a **pure quiz**: the student answers AI-generated questions with no feedback shown during the quiz. While answering, the frontend silently captures behavioral telemetry (focus/blur, hesitation, revisions, mouse activity, MCQ hover/switching) that the *not-yet-built* Evaluation phase will use, alongside the raw answer text, to produce a qualitative (not just correctness-based) assessment.

## Backend changes

### Schema — `questions` table
Add two nullable columns, MCQ-only:
- `options jsonb` — array of 4 option strings.
- `correct_index int` — 0-based index into `options`.

**Security constraint: `correct_index` is never returned to the quiz-taking frontend.** It's written by generation, read later by Evaluation (next sub-project) for grading. The quiz's question-fetching endpoint explicitly selects a column list that excludes it.

### `app/services/generation.py`
Update `GENERATION_SYSTEM_PROMPT`'s JSON schema so MCQ responses include:
```json
{ "options": ["...", "...", "...", "..."], "correct_index": 0 }
```
instead of embedding options inside `question_text`. Non-MCQ question types omit both fields (or return `null`).

### `app/routers/sessions.py`
- `_generate_session_questions`: insert `options`/`correct_index` (as returned by generation; `None` for non-MCQ) into the `questions` REST insert.
- `get_session_questions`: explicitly pass `select=id,session_id,chunk_id,topic_id,question_text,question_type,difficulty,options,expected_concepts,expected_time_seconds,citation_book,citation_author,citation_chapter,citation_page_start,citation_page_end,model_used,created_at` (omits `correct_index`).

### `app/models/question.py`
Add `options: list[str] | None = None` to `QuestionResponse`. No `correct_index` field on this model at all — it doesn't exist on the quiz-facing type, so it can't leak by accident later.

### Event tracking extension (no wire-format change)
New event types submitted through the existing `POST /answers/{id}/events` endpoint (still just `{event_type, event_at}` pairs — no request-model change):
- `mouse_activity` — frontend emits at most once per 2 seconds while the mouse moves over the question area (throttled client-side; never sends raw per-pixel movement).
- `option_hover_start` / `option_hover_end` — MCQ option hover start/end.
- MCQ option changes reuse the existing `edit` event type — a changed selection is a revision, same concept as editing a text answer, so `revision_count` already works unchanged for both question types with zero new logic.

### Schema — `answer_behaviour` table
Add two nullable int columns: `mouse_activity_count`, `option_hover_count`.

### `app/services/behaviour.py`
`compute_behaviour()` additionally tallies `mouse_activity` and `option_hover_start` events into the two new fields and includes them in its return dict. **The existing rule-based `behaviour_label` thresholds are unchanged in this phase** — richer interpretation of the new signals is Evaluation's job (next sub-project), not Generation's. This phase's only responsibility is capturing and storing them accurately.

### `app/routers/answers.py`
`submit_events`'s insert into `answer_behaviour_decrypted` gains the two new fields, populated from `compute_behaviour()`'s return value.

### SQL migration
A new file, `AIEDv2/add_mcq_and_behaviour_columns.sql`, run once in the Supabase SQL editor (same pattern as `decrypted_view_writes_and_rpc.sql`):
```sql
ALTER TABLE aied.questions ADD COLUMN IF NOT EXISTS options jsonb;
ALTER TABLE aied.questions ADD COLUMN IF NOT EXISTS correct_index int;
ALTER TABLE aied.answer_behaviour ADD COLUMN IF NOT EXISTS mouse_activity_count int DEFAULT 0;
ALTER TABLE aied.answer_behaviour ADD COLUMN IF NOT EXISTS option_hover_count int DEFAULT 0;
```
The `answer_behaviour_decrypted` view and its `INSTEAD OF INSERT` trigger (from the prior migration) need updating to pass these two new plain (non-encrypted) columns through.

## Frontend structure

```
frontend/src/
├── hooks/
│   └── useQuizSession.ts       — all non-visual logic (see below)
├── pages/
│   └── GenerationPage.tsx      — phase state machine: setup | generating | quiz | complete
└── components/quiz/
    ├── QuizSetupForm.tsx       — topic/difficulty/type/count picker → POST /sessions/
    ├── GeneratingScreen.tsx    — polling spinner, 45s timeout → retry
    ├── QuestionCard.tsx        — renders question_text + MCQ radios or text input; wires tracking listeners
    └── QuizComplete.tsx        — confirmation screen, link back to Dashboard
```

**Route:** `/generate` → `GenerationPage`, added to `main.tsx`'s `<Routes>` alongside the existing pages.

### `useQuizSession(sessionId?: string)` hook responsibilities
- Create session (`POST /sessions/`) from setup form values; returns the new `session_id`.
- Poll `GET /sessions/{id}` + `GET /sessions/{id}/questions` every 2s until `questions.length >= total_questions`, surfacing a `generating` boolean and an `error` if nothing arrives within 45s.
- Track current question index; expose `currentQuestion`, `questionNumber`, `totalQuestions`.
- Own the event buffer for the *current* question only — attaches `focus`/`blur` (window), `keystroke_start`/`edit` (answer input), throttled `mousemove` → `mouse_activity`, and (MCQ only) `option_hover_start/end` + reuses `edit` on selection change. Resets the buffer and re-attaches listeners on every question advance; detaches everything on unmount.
- `submitAnswer(answerText)`: `POST /answers/` → `POST /answers/{id}/events` with the buffered events → advance to next question, or if it was the last one, `POST /sessions/{id}/complete` and transition to `complete` phase.
- One automatic retry on network failure for submit calls; surfaces a persistent error (keeping the typed answer in place) if the retry also fails.

## Error handling
- Session creation or question generation failure → visible error + retry button, not an infinite spinner (45s timeout on the generating screen).
- Answer/event submission failure → one silent retry, then a visible error with the answer preserved on screen.
- Mid-quiz browser refresh is **not handled** in this version — known limitation, not solved here (would need server-side "resume position" tracking, out of scope).

## Explicitly out of scope for this sub-project
- Anything related to displaying evaluation results (next sub-project).
- Using the new `mouse_activity_count`/`option_hover_count` signals for anything beyond storage — no new `behaviour_label` rules, no UI display of them.
- Resuming a quiz after a refresh/navigation-away.
- Automated tests (no test framework exists in this codebase yet; verified manually by running both dev servers end-to-end).

## Testing / verification plan
Manual, end-to-end, using the `run` skill or direct dev-server startup: create a session with each difficulty/question-type combination at least once, confirm MCQ options render as clickable choices with no `correct_index` visible in Network tab responses, confirm behavior events reach `answer_behaviour` with the two new columns populated, confirm the 45s generation-timeout path by testing against a topic with no ingested chunks.
