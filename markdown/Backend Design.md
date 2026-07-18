# Official Backend Design — AI Education Platform
**Version:** 3.7  
**Last Updated:** July 2026  
**Status:** Approved for development

---

## Changelog

### v3.7 — 2026-07-19

| Change | Detail |
|---|---|
| **Added** | Structured chart output on the evaluation chat — `POST /evaluation-chat/chat` now forces Claude into a JSON schema response (`reply_text` + optional `chart`), the same `output_config.format.json_schema` mechanism already used for scoring elsewhere, instead of parsing free-text for chart-like content. `chart.kind` is `"line"`, `"bar"`, or `"none"`; the system prompt was tightened to default to including a chart whenever 2+ comparable numbers are being discussed, after live testing showed the first version was too conservative and skipped charts even for genuinely comparable data. |
| **Added** | `frontend/src/components/EvalChart.tsx` — plain-SVG line/bar rendering (no new npm dependency), using the `dataviz` skill's validated categorical palette. The project's own accent colors were checked with `validate_palette.js` and failed the dark-mode lightness-band check, so the skill's proven default palette is used for chart series instead of inventing one. |
| **Fixed** | Evaluation chat page used `minHeight` instead of a fixed `height` on its layout containers, so the whole page grew with the conversation instead of the message list scrolling internally — the send button kept sliding off-screen as messages accumulated. Fixed with a `height`-constrained flex column + `minHeight: 0` on the flexed message list (the standard fix for flex children that otherwise refuse to shrink below their content size). |
| **Added** | Lightweight Markdown rendering (`renderMarkdownLite` in `EvaluationPage.tsx`) for bold text and bullet lists in chat responses — no new dependency, handles only the subset of Markdown the model actually produces. |
| **Note** | Chart data is intentionally not persisted — only `reply_text` is written to `evaluation_chat_history`, so charts render for live-session messages only and are not reconstructed after a page reload. Disclosed scope cut, not an oversight, made under real time pressure ahead of a deadline. |

Full implementation detail: `TECHNICAL_LOG.md`.

### v3.6 — 2026-07-16

| Change | Detail |
|---|---|
| **Added** | Evaluation-analysis chatbot — `POST /evaluation-chat/chat` + `GET /evaluation-chat/history` (`backend/app/routers/evaluation_chat.py`), new `/evaluation` frontend page. Every reply is grounded in the student's real `progress_snapshots` + recent `evaluations` rows, injected into the system prompt on every call — the model explains already-computed numbers, it never scores or judges from raw answer text itself. |
| **Added** | `evaluation_chat_history` table — same shape and encryption as `goal_chat_history` (append-only, `role`/`content`, content encrypted). |
| **Note** | Charts/diagrams over this same data (originally scoped alongside this) are still deferred — this phase is chat-only, per explicit request to skip diagrams for now. |
| **Fixed** | First real chat response blended MCQ correctness (a flat 100/0 collapsed across every dimension) with free-text rubric scores as if equally meaningful, and never queried `answer_behaviour` at all despite that being the whole documented point of tracking it (see "Behavioural Tracking & Privacy" above). System prompt now labels every data point by question_type, explicitly forbids treating MCQ as a depth-of-understanding signal, includes a rubric legend (esp. clarifying `wording_score` is bias-neutral by design, not an English-fluency test), and joins in `answer_behaviour_decrypted` per answer. |
| **Reason** | Chat costs a real Claude call per message (`CLAUDE_CHATBOT_MODEL`, same model as the goal-setting chat) — deferred earlier in the same day for cost reasons, then explicitly requested anyway once cost was acknowledged. |

Full implementation detail: `TECHNICAL_LOG.md`.

### v3.5 — 2026-07-16

| Change | Detail |
|---|---|
| **Added** | Two new deterministic (non-AI) evaluation dimensions: `conciseness_score` and `copy_similarity_score` on `evaluations`, plus their per-topic averages (`avg_conciseness`, `avg_copy_similarity`) on `progress_snapshots`. See "Conciseness & Copy-Detection Scoring" under Scoring Model below. |
| **Note** | Scoped as the first phase of the planned Evaluation Dashboard (self-facing charts + a grounded Q&A chat over this data). The chat piece needs a paid Claude call per message — deferred until budget allows, same reasoning as the provider swap above. This phase is backend-only: no new endpoint or frontend page yet. |
| **Reason** | Requested as part of the Evaluation Dashboard, with an explicit requirement that these be real computed scores — not an AI asked to "vibe-judge" a student from raw data — matching how every other scoring dimension in this document already works. |

Full implementation detail: `TECHNICAL_LOG.md`.

### v3.4 — 2026-07-07

| Change | Detail |
|---|---|
| **Replaced** | Embeddings: `gemini-embedding-001` (API, 1000/day free-tier quota) → local `BAAI/bge-base-en-v1.5` via `sentence-transformers` — native 768 dims, no rate limits, ~100-150x faster on this machine's GPU |
| **Fixed** | `ingestion_status` could freeze at `processing` forever if the backend died mid-run, with nothing actually running — added startup reconciliation (any `pending`/`processing` row at cold boot is unconditionally stale) and a `409` guard against double-triggering retry |
| **Reason** | A single large textbook approaches Gemini's free-tier daily embedding quota on its own; iterative dev usage compounds it further. A local model removes the constraint entirely rather than working around it (rejected: rotating multiple Google accounts for more quota — ToS risk, doesn't remove the ceiling, just raises it). |

Full implementation detail: `TECHNICAL_LOG.md`.

### v3.3 — 2026-07-07

| Change | Detail |
|---|---|
| **Replaced** | Embeddings: `text-embedding-004` (fully retired by Google) → `gemini-embedding-001`, truncated to 768 dims via `output_dimensionality` — no schema change needed |
| **Added** | Retry-with-exponential-backoff on embedding calls (`app/services/embedding.py`, new, also de-duplicates the client boilerplate previously copy-pasted between `ingestion.py` and `rag.py`) — the free tier's per-minute quota is real and was killing ingestion runs on any book of meaningful size |
| **Added** | Document upload dashboard (`/upload`, admin-only) + admin document endpoints (`GET /documents/admin`, `GET /documents/{id}`, `POST /documents/{id}/retry`) |
| **Added** | Live backend log streaming — `GET /logs/stream` (SSE, admin-only) plus an in-memory broadcast handler (`app/log_stream.py`) wired into the existing structured logger. Frontend renders it as a devtools-style persistent left-docked panel (`AppShell` + `LiveLogSidebar`) that survives route navigation. |
| **Fixed** | `get_supabase()` was building a malformed Storage URL (double path through `/rest/v1/`), causing every Storage operation to 404 against the wrong subsystem — see `TECHNICAL_LOG.md` |
| **Fixed** | CORS-masking on unhandled exceptions, for real this time — the catch-all handler now attaches CORS headers by hand, since Starlette hoists bare-`Exception` handlers outside `CORSMiddleware` entirely (no middleware reordering can fix that) |
| **Fixed** | Ingestion retries duplicated already-succeeded chunks (no unique constraint on `document_id, chunk_index`) — `ingest_document` now clears existing chunks for the document before (re-)starting |
| **Reason** | The ingestion pipeline had never been exercised with a real document before this session — auth and quiz flows don't touch Storage or the embedding API at all. Four independent, previously-undetected bugs surfaced from a single real upload. |

Full implementation detail: `TECHNICAL_LOG.md`.

### v3.2 — 2026-07-06

| Change | Detail |
|---|---|
| **Removed** | `asyncpg` / `DATABASE_URL` — no direct Postgres connection anywhere in the backend anymore |
| **Added** | `INSTEAD OF INSERT/UPDATE` triggers on all 7 encrypted-column `*_decrypted` views (`decrypted_view_writes_and_rpc.sql`) — completes the encrypt-on-write half of the pattern that only had encrypt-on-read (the views) before |
| **Added** | 5 Postgres RPC functions for SQL that PostgREST's REST filters can't express (pgvector hybrid search, full-text chunk ranking, multi-table score/progress aggregates, atomic document-access counters) |
| **Replaced** | Every router/service now talks to Supabase exclusively via REST (`backend/app/supabase_rest.py`) — same access pattern as the encrypted-PII design in the other (invoice OCR) project this schema was modeled on |
| **Reason** | The DB access layer had drifted into two patterns (`asyncpg` direct SQL for most routes, REST for auth) for no functional reason — encrypted-column writes only ever needed *some* SQL to run inside Postgres (the vault key isn't REST-reachable), not a persistent app-side connection. Consolidating onto REST + triggers + RPC removes the second connection type and its own credential (`DATABASE_URL`) entirely. |

Full implementation detail: `TECHNICAL_LOG.md`.

### v3.1 — 2026-07-03

| Change | Detail |
|---|---|
| **Replaced** | Question generation: Claude Haiku 4.5 (via AWS Bedrock) → Gemini 2.5 Flash (free tier) |
| **Replaced** | Evaluation + goal chatbot: Claude Sonnet 4.6 (via AWS Bedrock) → Gemini 2.5 Flash (free tier) |
| **Reason** | Generation/evaluation were running on employer-billed AWS Bedrock credentials for a personal project. Switched to a free, personal-account provider to remove all shared billing surface. Plan is to switch back to Claude once self-funded. |
| **Note** | Mentions of "Haiku"/"Sonnet" elsewhere in this document (Scoring Model, Database Tables) are left as historical/descriptive text and were not individually rewritten — the live model is tracked in `backend/app/config.py`'s `GEMINI_MODEL` constant. |

Full implementation detail: `TECHNICAL_LOG.md`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Primary database | Supabase (PostgreSQL) |
| Vector store | pgvector extension within Supabase |
| File storage | Supabase Storage (PDFs) |
| Search strategy | Hybrid — pgvector (semantic 60%) + PostgreSQL FTS (keyword 40%) |
| Embeddings | Local `BAAI/bge-base-en-v1.5` via `sentence-transformers`, native 768 dimensions *(was Google `gemini-embedding-001` — moved off entirely after repeatedly hitting its 1000/day free-tier quota; before that, `text-embedding-004`, retired by Google)* |
| Question generation | Gemini 2.5 Flash *(was Claude Haiku 4.5)* |
| Evaluation + scoring | Gemini 2.5 Flash *(was Claude Sonnet 4.6)* |
| Hallucination checker | xAI Grok |
| Auth / 2FA | Microsoft Entra ID |
| Backend | FastAPI (Python) |
| Frontend | React + CSS/HTML |

---

## Chunk Strategy

| Parameter | Value | Reason |
|---|---|---|
| Chunk size | 800–1000 tokens | AIML explanations need context — 500 tokens cuts off derivations |
| Overlap | 150–200 tokens | Prevents concept split across chunk boundaries |
| Search weights | 60% semantic / 40% keyword | Semantic catches concepts, keyword catches exact technical terms |

---

## Generation & Retrieval Configuration

These settings are centralised in a single backend config. Never hardcode them inside individual API calls. If values need tuning after real usage data is collected, change them in one place only.

### Question Generation (Gemini 2.5 Flash)

Temperature controls question creativity and variety. Top P controls vocabulary conservatism. Both increase with difficulty so harder questions are more varied and conceptually demanding.

| Difficulty | Temperature | Top P | Reason |
|---|---|---|---|
| Easy | 0.3 | 0.85 | Conservative — straightforward questions, clear unambiguous phrasing |
| Medium | 0.5 | 0.90 | Moderate creativity — varied question styles and framing |
| Hard | 0.7 | 0.95 | Higher creativity — complex multi-concept questions, edge cases |
| Mixed | 0.5 | 0.90 | Defaults to medium as baseline |

### Evaluation (Gemini 2.5 Flash)

Evaluation temperature is fixed across all difficulties. The scoring rubric does not change based on difficulty — only the expected concepts differ. Consistent temperature guarantees that two students giving identical answers always receive identical scores. Changing evaluation temperature by difficulty would introduce scoring variance that undermines trust in the system.

| Use case | Temperature | Top P | Reason |
|---|---|---|---|
| All difficulties | 0.1 | 0.80 | Near-deterministic — evaluation must be reproducible and consistent |

### Hallucination Checker (xAI Grok)

Grok's role is a binary fact-check on Sonnet's evaluation output — does this evaluation contain hallucinated claims? This is a yes/no decision requiring zero creativity.

| Use case | Temperature | Top P | Reason |
|---|---|---|---|
| All checks | 0.0 | 0.75 | Fully deterministic — no randomness appropriate for a binary flag decision |

### RAG Retrieval Top K

Top K controls how many chunks are retrieved from pgvector before the model generates from them. Higher K gives the model broader context but introduces more noise. For evaluation, Sonnet receives the same retrieved chunks as context alongside the student's answer — higher K for hard questions means richer context for fairer evaluation of complex multi-concept answers.

| Difficulty | Top K | Reason |
|---|---|---|
| Easy | 3 | Narrow retrieval — simple concepts have clear source sections |
| Medium | 5 | Standard retrieval — some concepts span multiple sections |
| Hard | 7 | Broader retrieval — complex topics need cross-section context |
| Mixed | 5 | Defaults to medium as baseline |

### Centralised Python Config

```python
GENERATION_CONFIG = {
    "easy":   {"temperature": 0.3, "top_p": 0.85, "top_k_rag": 3},
    "medium": {"temperature": 0.5, "top_p": 0.90, "top_k_rag": 5},
    "hard":   {"temperature": 0.7, "top_p": 0.95, "top_k_rag": 7},
    "mixed":  {"temperature": 0.5, "top_p": 0.90, "top_k_rag": 5},
}

EVALUATION_CONFIG = {
    "temperature": 0.1,
    "top_p": 0.80,
}

HALLUCINATION_CONFIG = {
    "temperature": 0.0,
    "top_p": 0.75,
}
```

---

## Scoring Model

### Per-question scoring

```
Factual Correctness   — Is the answer factually accurate against the source chunk?
Structure Score       — Is the answer clear and understandable to an outside reader?

Accuracy        = (Factual Correctness × 0.70) + (Structure × 0.30)
Recall          = Concepts covered / Total expected concepts
Precision       = Relevant content / Total content written
Wording         = Bias-neutral clarity score from Sonnet (neutral across regional writing styles)

Raw Score       = (Accuracy × 0.35) + (Recall × 0.30) + (Precision × 0.20) + (Wording × 0.15)

Time Modifier   = max(0.70, 1 - (0.1 × max(0, active_minutes - expected_minutes)))

Behaviour Adjustment:
  distracted  → time_modifier × 0.95   (slight penalty — partially their fault)
  struggling  → time_modifier × 1.00   (no extra penalty — actively engaged)
  guessing    → time_modifier × 0.90   (penalise — did not engage meaningfully)
  confident   → time_modifier × 1.00   (full score)
  neutral     → time_modifier × 1.00   (no adjustment)

Final Score     = Raw Score × Time Modifier
```

### Scoring weight rationale

| Component | Weight | Reason |
|---|---|---|
| Factual correctness | 70% of accuracy | Correct answers matter most academically |
| Structure | 30% of accuracy | Rewards clear communication without punishing regional writing styles |
| Accuracy | 35% of raw score | Primary academic concern |
| Recall | 30% of raw score | Missing concepts is a stronger signal of misunderstanding than imprecise wording |
| Precision | 20% of raw score | Relevance matters but is secondary |
| Wording | 15% of raw score | Lowest weight — evaluator explicitly instructed to be style-neutral |

### Expected time by question type

| Question type | Difficulty | Expected time |
|---|---|---|
| MCQ | Any | 45 seconds |
| Short answer | Easy | 90 seconds |
| Short answer | Medium | 2 minutes |
| Short answer | Hard | 3 minutes |
| Long answer | Easy | 4 minutes |
| Long answer | Medium | 6 minutes |
| Long answer | Hard | 8 minutes |

Expected times are hardcoded at launch and configurable after real usage data is collected.

### Conciseness & Copy-Detection Scoring (computed on backend, no AI)

Both are separate dimensions shown alongside the existing breakdown — neither feeds into Raw Score or Final Score. Deliberately kept out of that formula so the already-implemented, already-tested scoring model stays untouched; folding them in would require rebalancing weights that are currently load-bearing for `overall_score`/`progress_snapshots`.

**Conciseness** — measures brevity of expression, not completeness. An answer that's too short to cover the material is already penalised by `recall_score`, so this only penalises going past a reasonable upper bound; it never penalises being short.

| Question type | Difficulty | Expected max words |
|---|---|---|
| MCQ | Any | N/A — not scored (a selected option isn't a conciseness question) |
| Short answer | Easy | 40 |
| Short answer | Medium | 50 |
| Short answer | Hard | 60 |
| Long answer | Easy | 120 |
| Long answer | Medium | 160 |
| Long answer | Hard | 200 |

```
word_count <= expected_max  →  conciseness_score = 100
word_count >  expected_max  →  conciseness_score = max(0, 100 × (1 − (word_count − expected_max) / expected_max))
```

**Copy-detection** — a containment measure (not symmetric similarity): what fraction of the answer's own 8-word runs also appear verbatim in the source chunk. An 8-word verbatim match is a strong signal of direct copying; shorter windows (3-4 words) would flag too many innocent shared-terminology matches. Symmetric similarity (e.g. `difflib.SequenceMatcher` over the whole chunk) was rejected — copying one sentence out of an 800-1000 token chunk would still register as "low similarity" against the chunk as a whole, missing the exact case this exists to catch.

```
answer_ngrams = set of every consecutive 8-word run in the answer
chunk_ngrams  = set of every consecutive 8-word run in the source chunk
copy_similarity_score = 100 × |answer_ngrams ∩ chunk_ngrams| / |answer_ngrams|
```

Answers shorter than 8 words have no 8-word run to test — scored `None` ("not enough text to assess"), not `0`, so a short-but-original answer isn't misread as "definitely not copied" when it simply couldn't be tested. MCQ is also `None` — a selected option is copied by construction, so the score wouldn't mean anything.

### Behaviour label rules (computed on backend, no AI)

```python
if distraction_ratio > 0.5:
    label = "distracted"
elif pause_count > 5 and revision_count > 3:
    label = "struggling"
elif answer_start_delay > 60 and revision_count < 2:
    label = "guessing"
elif active_time >= expected_time * 0.8 and revision_count > 1:
    label = "confident"
else:
    label = "neutral"
```

---

## PDF Access Strategy

Students access PDFs via short-lived signed URLs generated server-side on demand. Raw storage URLs are never exposed to the frontend. Signed URLs expire after 30 minutes and cannot be shared or reused.

The frontend distinguishes two actions:
- **View** — opens signed URL in a new browser tab, no download triggered
- **Download** — FastAPI proxy endpoint sets `Content-Disposition: attachment`, triggers file save

Both actions are tracked separately in `user_documents`.

### Repeat download protection

```
No row exists       → first access, create row, serve URL silently
downloaded = false  → show "Last viewed [date]", serve URL
downloaded = true   → show warning modal:
                      "You downloaded this on [date]. Download again?"
                      [ Cancel ] [ Download anyway ]
```

### My Library query

```sql
SELECT d.title, d.author, d.document_type, d.difficulty,
       ud.last_accessed_at, ud.downloaded,
       ud.download_count, ud.access_count
FROM user_documents ud
JOIN documents d ON ud.document_id = d.id
WHERE ud.user_id = $1
ORDER BY ud.last_accessed_at DESC;
```

---

## Behavioural Tracking & Privacy

### What is tracked

While a student is answering questions, the frontend sends timestamped events capturing focus, blur, keystroke start, edits, and submission. Used exclusively to compute `active_time_seconds`, `distraction_ratio`, `pause_count`, `revision_count`, and `behaviour_label` which feed the time modifier in the scoring model.

### Data retention

| Data | Retention | Reason |
|---|---|---|
| Raw events (`question_events`) | 30 days then hard deleted | Sensitive behavioural stream, not needed after aggregation |
| Aggregated metrics (`answer_behaviour`) | Permanent | Computed insights used for dashboard and scoring |

### Disclosure approach

**1. At signup**
Student must tick a checkbox explicitly referencing the section:
> "I have read and agree to Section 4.2 — Learning Behaviour Tracking"

**2. First question attempt — just-in-time banner (shown once)**
> "While answering questions, we track your focus and interaction patterns to better understand your learning progress. This helps us identify when you're struggling, distracted, or confident — improving your personalised recommendations. See **Section 4.2 of our Terms**."
> [ Got it ] [ Learn more → ]

"Learn more" links directly to Section 4.2. Once dismissed, never shown again. Dismissal recorded in `user_consents`.

**3. Persistent session indicator**
Small non-intrusive icon in the corner of the question interface during every session. Tooltip on hover:
> "Session activity is being tracked to measure your learning. Section 4.2"

Always visible. Cannot be removed.

---

## Database Tables

### 1. `users`
Anonymized student accounts. No real names stored. Passwords are meaningless hashes.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | `gen_random_uuid()` |
| `display_name` | `varchar(50)` | System-generated alias e.g. `user_x7k2` |
| `email_hash` | `varchar(255)` | SHA-256 hashed email for lookup only |
| `password_hash` | `varchar(255)` | Bcrypt hashed, minimum 12 rounds |
| `entra_id` | `varchar(255)` | Microsoft Entra ID object ID for 2FA |
| `role` | `varchar(20)` | `student` / `admin` |
| `created_at` | `timestamptz` | Default `now()` |
| `last_active` | `timestamptz` | Updated on every authenticated request |
| `is_active` | `boolean` | Soft delete — never hard delete users |

---

### 2. `user_consents`
Timestamped audit trail of every consent action per user per policy version. Append-only — never update or delete rows.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `user_id` | `uuid` FK → `users.id` | |
| `consent_type` | `varchar(100)` | `terms_and_conditions` / `behavioural_tracking` / `data_retention` |
| `policy_version` | `varchar(20)` | e.g. `v1.0` — bump on any T&C update |
| `section_reference` | `varchar(50)` | e.g. `Section 4.2` — exact section consented to |
| `consented_at` | `timestamptz` | |
| `consent_method` | `varchar(50)` | `signup_checkbox` / `banner_dismissed` / `explicit_confirm` |
| `ip_hash` | `varchar(255)` | SHA-256 hashed IP at time of consent |
| `banner_dismissed` | `boolean` | Whether the just-in-time banner was dismissed |
| `banner_dismissed_at` | `timestamptz` | |

---

### 3. `student_profiles`
Basic extended student info. Goals normalized into `student_goals`. Difficulty not stored here — selected per session on frontend.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `user_id` | `uuid` FK → `users.id` | One-to-one, unique |
| `target_exam` | `varchar(255)` | e.g. `Final Year ML Exam 2025` |
| `target_date` | `date` | Goal deadline for dashboard proximity tracking |
| `study_hours_per_week` | `int` | Self-reported, used for study plan projection |
| `updated_at` | `timestamptz` | |

---

### 4. `student_goals`
Normalized goals. Each goal is its own row. Sonnet 4.6 extracts and structures goals from `goal_chat_history` and writes here.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `user_id` | `uuid` FK → `users.id` | |
| `goal_text` | `text` | Sonnet-paraphrased plain English summary |
| `goal_structured` | `jsonb` | e.g. `{"type": "exam_pass", "target_score": 80, "topic": "Neural Networks", "deadline": "2025-06-01"}` |
| `topic_id` | `uuid` FK → `topics.id` NULLABLE | Which topic this goal relates to |
| `status` | `varchar(20)` | `active` / `completed` / `deleted` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

---

### 5. `goal_chat_history`
Complete append-only conversation log from the Sonnet 4.6 goal-setting chatbot. Source of truth for goal conversation. Never modified or deleted.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `user_id` | `uuid` FK → `users.id` | |
| `role` | `varchar(20)` | `user` / `assistant` |
| `content` | `text` | Full message content |
| `created_at` | `timestamptz` | |

**Flow:**
```
Student types → saved to goal_chat_history (role: user)
Sonnet responds → saved to goal_chat_history (role: assistant)
Backend extracts goal deltas → writes to student_goals
```

---

### 6. `topics`
Subject taxonomy tree. Every document, chunk, question, session, recommendation, and progress snapshot maps to a node here.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `name` | `varchar(255)` | e.g. `Backpropagation` |
| `slug` | `varchar(255)` UNIQUE | e.g. `backpropagation` |
| `parent_id` | `uuid` FK → `topics.id` NULLABLE | `NULL` for root topics |
| `level` | `int` | 0 = root, 1 = subtopic, 2 = concept |
| `description` | `text` | Plain English description |

**Example taxonomy:**
```
AIML  (level 0)
├── Supervised Learning  (level 1)
│   ├── Linear Regression  (level 2)
│   └── Neural Networks  (level 2)
│       ├── Backpropagation  (level 2)
│       └── Activation Functions  (level 2)
├── Unsupervised Learning  (level 1)
│   ├── K-Means Clustering  (level 2)
│   └── PCA  (level 2)
└── Reinforcement Learning  (level 1)
    └── Q-Learning  (level 2)
```

---

### 7. `documents`
Metadata for every uploaded textbook or past paper. Raw PDF in Supabase Storage. Only storage key saved — signed URLs generated on demand.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `title` | `varchar(500)` | e.g. `Introduction to Machine Learning` |
| `author` | `varchar(255)` | e.g. `Tom Mitchell` |
| `document_type` | `varchar(50)` | `textbook` / `past_paper` / `notes` |
| `difficulty` | `varchar(20)` | `easy` / `medium` / `hard` |
| `storage_key` | `varchar(500)` | Supabase Storage object key |
| `total_pages` | `int` | Extracted during ingestion |
| `total_chunks` | `int` | Populated after ingestion completes |
| `ingestion_status` | `varchar(50)` | `pending` / `processing` / `complete` / `failed` |
| `uploaded_by` | `uuid` FK → `users.id` | Admin who uploaded |
| `uploaded_at` | `timestamptz` | |
| `topic_id` | `uuid` FK → `topics.id` | Primary subject area |

---

### 8. `user_documents`
Per-student document access history. Powers My Library and repeat download protection. One row per student per document.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `user_id` | `uuid` FK → `users.id` | |
| `document_id` | `uuid` FK → `documents.id` | |
| `first_accessed_at` | `timestamptz` | Set once, never updated |
| `last_accessed_at` | `timestamptz` | Updated on every access |
| `access_count` | `int` | Incremented on every access |
| `downloaded` | `boolean` | `true` if student has explicitly downloaded |
| `download_count` | `int` | Total explicit downloads |
| `last_downloaded_at` | `timestamptz` | Shown in warning before re-download |

**UNIQUE constraint:** `(user_id, document_id)`

---

### 9. `document_chunks`
Core RAG table. One row per chunk with embedding, FTS vector, and full citation metadata.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `document_id` | `uuid` FK → `documents.id` | |
| `topic_id` | `uuid` FK → `topics.id` | Auto-tagged during ingestion |
| `chunk_index` | `int` | Sequence number, zero-based |
| `content` | `text` | Raw chunk text, 800–1000 tokens |
| `page_start` | `int` | First page this chunk appears on |
| `page_end` | `int` | Last page this chunk appears on |
| `chapter` | `varchar(255)` | Chapter title, extracted during ingestion |
| `section` | `varchar(255)` | Section heading, extracted during ingestion |
| `difficulty` | `varchar(20)` | Inherited from document or AI-tagged per chunk |
| `embedding` | `vector(768)` | Local `BAAI/bge-base-en-v1.5` output, native 768 dims *(was Google `gemini-embedding-001`/`text-embedding-004` — see Tech Stack table)* |
| `fts_vector` | `tsvector` | PostgreSQL FTS vector, auto-populated via trigger |
| `created_at` | `timestamptz` | |

**Indexes:**
```sql
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON document_chunks USING GIN (fts_vector);
CREATE INDEX ON document_chunks (document_id, difficulty);
CREATE INDEX ON document_chunks (topic_id);
```

---

### 10. `test_sessions`
Parent record for each test attempt. Records the exact generation settings used so every question in this session is fully reproducible.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `user_id` | `uuid` FK → `users.id` | |
| `topic_id` | `uuid` FK → `topics.id` | Primary topic tested |
| `difficulty` | `varchar(20)` | Frontend-selected: `easy` / `medium` / `hard` / `mixed` |
| `total_questions` | `int` | |
| `status` | `varchar(20)` | `in_progress` / `completed` / `abandoned` |
| `overall_score` | `numeric(5,2)` | Weighted aggregate of all final scores |
| `generation_temperature` | `numeric(3,2)` | Temperature used for question generation in this session |
| `generation_top_p` | `numeric(3,2)` | Top P used for question generation in this session |
| `retrieval_top_k` | `int` | Number of chunks retrieved per question in this session |
| `started_at` | `timestamptz` | |
| `completed_at` | `timestamptz` | NULL until status = completed |

---

### 11. `questions`
Each AI-generated question tied to its source chunk. Citation fields denormalized for fast rendering.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `session_id` | `uuid` FK → `test_sessions.id` | |
| `chunk_id` | `uuid` FK → `document_chunks.id` | Source of truth for citation |
| `topic_id` | `uuid` FK → `topics.id` | |
| `question_text` | `text` | The generated question |
| `question_type` | `varchar(50)` | `short_answer` / `long_answer` / `mcq` |
| `difficulty` | `varchar(20)` | Inherited from session |
| `expected_concepts` | `jsonb` | Key concepts answer must cover — generated by Haiku, used by Sonnet as ground truth |
| `expected_time_seconds` | `int` | Set by Haiku at generation time based on question type and difficulty |
| `citation_book` | `varchar(500)` | Denormalized from `documents.title` |
| `citation_author` | `varchar(255)` | Denormalized from `documents.author` |
| `citation_chapter` | `varchar(255)` | Denormalized from `document_chunks.chapter` |
| `citation_page_start` | `int` | Denormalized from `document_chunks.page_start` |
| `citation_page_end` | `int` | Denormalized from `document_chunks.page_end` |
| `model_used` | `varchar(100)` | e.g. `claude-haiku-4-5` |
| `created_at` | `timestamptz` | |

---

### 12. `answers`
The student's raw response to each question.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `question_id` | `uuid` FK → `questions.id` | |
| `user_id` | `uuid` FK → `users.id` | |
| `session_id` | `uuid` FK → `test_sessions.id` | |
| `answer_text` | `text` | Raw student answer as submitted |
| `submitted_at` | `timestamptz` | |

---

### 13. `question_events`
Raw behavioural event stream from the frontend. Append-only. Hard deleted after 30 days — aggregated metrics stored in `answer_behaviour` before deletion.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `answer_id` | `uuid` FK → `answers.id` | |
| `user_id` | `uuid` FK → `users.id` | |
| `question_id` | `uuid` FK → `questions.id` | |
| `session_id` | `uuid` FK → `test_sessions.id` | |
| `event_type` | `varchar(50)` | `focus` / `blur` / `keystroke_start` / `edit` / `submit` |
| `event_at` | `timestamptz` | Precise timestamp from frontend |
| `expires_at` | `timestamptz` | `event_at + 30 days` — used by nightly cleanup job |

---

### 14. `answer_behaviour`
Permanent aggregated behavioural metrics computed from `question_events` on answer submission. Feeds the scoring model time modifier.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `answer_id` | `uuid` FK → `answers.id` | One-to-one |
| `user_id` | `uuid` FK → `users.id` | |
| `question_id` | `uuid` FK → `questions.id` | |
| `session_id` | `uuid` FK → `test_sessions.id` | |
| `active_time_seconds` | `int` | Total time question had focus |
| `total_elapsed_seconds` | `int` | Wall clock from first focus to submit |
| `pause_count` | `int` | Number of times focus left and returned |
| `distraction_ratio` | `numeric(4,3)` | Blur duration / elapsed time, 0.000–1.000 |
| `answer_start_delay_seconds` | `int` | Gap between first focus and first keystroke |
| `revision_count` | `int` | Number of edits after initial writing |
| `behaviour_label` | `varchar(20)` | `confident` / `struggling` / `distracted` / `guessing` / `neutral` |
| `time_modifier` | `numeric(4,3)` | Final computed modifier, 0.700–1.000 |

---

### 15. `evaluations`
Per-question evaluation output from Sonnet 4.6 and xAI Grok. Permanent. Records exact evaluation settings for full reproducibility.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `answer_id` | `uuid` FK → `answers.id` | One-to-one |
| `question_id` | `uuid` FK → `questions.id` | |
| `session_id` | `uuid` FK → `test_sessions.id` | |
| `user_id` | `uuid` FK → `users.id` | |
| `factual_correctness_score` | `numeric(5,2)` | 0–100. Factual accuracy against source chunk |
| `structure_score` | `numeric(5,2)` | 0–100. Clarity to an outside reader |
| `accuracy_score` | `numeric(5,2)` | (factual × 0.70) + (structure × 0.30) |
| `precision_score` | `numeric(5,2)` | 0–100. Relevance of what was written |
| `recall_score` | `numeric(5,2)` | 0–100. Coverage of expected_concepts |
| `wording_score` | `numeric(5,2)` | 0–100. Bias-neutral clarity from Sonnet |
| `raw_score` | `numeric(5,2)` | (accuracy×0.35) + (recall×0.30) + (precision×0.20) + (wording×0.15) |
| `time_modifier` | `numeric(4,3)` | Copied from `answer_behaviour.time_modifier` |
| `final_score` | `numeric(5,2)` | raw_score × time_modifier — shown on dashboard |
| `concepts_covered` | `jsonb` | Subset of expected_concepts addressed |
| `concepts_missed` | `jsonb` | Subset of expected_concepts missed — feeds recommendations |
| `feedback_text` | `text` | Sonnet-generated human-readable feedback |
| `hallucination_flag` | `boolean` | `true` if xAI Grok flagged this evaluation |
| `hallucination_note` | `text` | Description of what was flagged |
| `evaluator_model` | `varchar(100)` | e.g. `claude-sonnet-4-6` |
| `evaluation_temperature` | `numeric(3,2)` | Temperature used for this evaluation call |
| `evaluation_top_p` | `numeric(3,2)` | Top P used for this evaluation call |
| `checker_model` | `varchar(100)` | e.g. `grok-2` |
| `created_at` | `timestamptz` | |
| `conciseness_score` | `numeric(5,2)` | 0–100, `NULL` for MCQ. See "Conciseness & Copy-Detection Scoring" above. Not part of raw_score/final_score. |
| `copy_similarity_score` | `numeric(5,2)` | 0–100, `NULL` for MCQ or answers under 8 words. Same section. Not part of raw_score/final_score. |

---

### 16. `recommendations`
Each section recommendation with engagement tracking. Generated after each completed session from `concepts_missed`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `user_id` | `uuid` FK → `users.id` | |
| `session_id` | `uuid` FK → `test_sessions.id` | Session that triggered this |
| `chunk_id` | `uuid` FK → `document_chunks.id` | Exact chunk recommended |
| `topic_id` | `uuid` FK → `topics.id` | Weak area this addresses |
| `reason` | `text` | Plain English explanation |
| `priority` | `int` | 1 = highest priority |
| `viewed` | `boolean` | `true` when student opens the PDF section |
| `viewed_at` | `timestamptz` | |
| `created_at` | `timestamptz` | |

---

### 17. `progress_snapshots`
Pre-aggregated scores per topic per student. Computed after every completed session. Dashboard reads from here only — never recalculates from raw rows at load time.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | |
| `user_id` | `uuid` FK → `users.id` | |
| `topic_id` | `uuid` FK → `topics.id` | |
| `snapshot_date` | `date` | Date of computation |
| `avg_factual_correctness` | `numeric(5,2)` | |
| `avg_structure` | `numeric(5,2)` | |
| `avg_accuracy` | `numeric(5,2)` | |
| `avg_precision` | `numeric(5,2)` | |
| `avg_recall` | `numeric(5,2)` | |
| `avg_wording` | `numeric(5,2)` | |
| `avg_raw_score` | `numeric(5,2)` | Before time modifier — knowledge level independent of speed |
| `avg_final_score` | `numeric(5,2)` | After time modifier — used for goal proximity |
| `avg_time_modifier` | `numeric(4,3)` | Average time performance for this topic |
| `dominant_behaviour` | `varchar(20)` | Most common behaviour label in this topic |
| `questions_attempted` | `int` | |
| `sessions_completed` | `int` | |
| `goal_proximity` | `numeric(5,2)` | 0–100, how close to target score for this topic |
| `avg_conciseness` | `numeric(5,2)` | Average of `evaluations.conciseness_score` for this topic, `NULL`-safe |
| `avg_copy_similarity` | `numeric(5,2)` | Average of `evaluations.copy_similarity_score` for this topic, `NULL`-safe |

**Design note:** Both `avg_raw_score` and `avg_final_score` stored separately so the dashboard can surface distinct insights — e.g. "you know this material well but you're consistently slow on hard questions."

---

## Complete Relationships

```
users
├── user_consents (1:many, append-only)
├── student_profiles (1:1)
├── student_goals (1:many)
│     └── written by Sonnet from goal_chat_history
├── goal_chat_history (1:many, append-only)
├── user_documents (1:many)
├── test_sessions (1:many)
│     ├── questions (1:many)
│     │     └── answers (1:1)
│     │           ├── question_events (1:many, TTL 30 days)
│     │           ├── answer_behaviour (1:1, permanent)
│     │           └── evaluations (1:1)
│     └── recommendations (1:many)
└── progress_snapshots (1:many)

documents
├── user_documents (1:many)
└── document_chunks (1:many)
      ├── questions (many:1)
      └── recommendations (many:1)

topics
├── student_goals (many:1)
├── documents (many:1)
├── document_chunks (many:1)
├── questions (many:1)
├── test_sessions (many:1)
├── recommendations (many:1)
└── progress_snapshots (many:1)
```

---

## Hybrid Search Query

```sql
SELECT
  dc.id,
  dc.content,
  dc.page_start,
  dc.page_end,
  dc.chapter,
  dc.section,
  d.title   AS book_title,
  d.author  AS book_author,
  (
    0.6 * (1 - (dc.embedding <=> $1::vector))
    + 0.4 * ts_rank(dc.fts_vector, query)
  ) AS hybrid_score
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id,
  plainto_tsquery('english', $2) query
WHERE
  dc.difficulty = $3
  AND dc.fts_vector @@ query
ORDER BY hybrid_score DESC
LIMIT $4;

-- $1 = query embedding vector
-- $2 = keyword query string
-- $3 = difficulty filter from session
-- $4 = top_k from GENERATION_CONFIG[difficulty]
```

---

## Database Setup

```sql
-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Auto-populate fts_vector on chunk insert or update
CREATE TRIGGER update_chunk_fts
BEFORE INSERT OR UPDATE ON document_chunks
FOR EACH ROW EXECUTE FUNCTION
tsvector_update_trigger(fts_vector, 'pg_catalog.english', content);

-- Unique constraint on user_documents
ALTER TABLE user_documents
ADD CONSTRAINT uq_user_document UNIQUE (user_id, document_id);

-- Nightly cleanup Edge Function:
-- DELETE FROM question_events WHERE expires_at < now();

-- Progress snapshot Edge Function:
-- Fires when test_sessions.status changes to 'completed'
-- Aggregates evaluations → upserts progress_snapshots for today
```

---

## Table Count Summary

| # | Table | Purpose |
|---|---|---|
| 1 | `users` | Anonymized accounts |
| 2 | `user_consents` | Consent audit trail per policy version |
| 3 | `student_profiles` | Basic extended info |
| 4 | `student_goals` | Normalized goals from chat |
| 5 | `goal_chat_history` | Goal conversation log, append-only |
| 6 | `topics` | Subject taxonomy tree |
| 7 | `documents` | PDF metadata |
| 8 | `user_documents` | Per-student document access history |
| 9 | `document_chunks` | RAG chunks with embeddings |
| 10 | `test_sessions` | Test attempt parent record with generation settings |
| 11 | `questions` | Generated questions with citations and expected time |
| 12 | `answers` | Student responses |
| 13 | `question_events` | Raw behavioural events, 30 day TTL |
| 14 | `answer_behaviour` | Aggregated behavioural metrics, permanent |
| 15 | `evaluations` | Per-question scores, feedback, and evaluation settings |
| 16 | `recommendations` | Exact section recommendations |
| 17 | `progress_snapshots` | Pre-aggregated dashboard data |