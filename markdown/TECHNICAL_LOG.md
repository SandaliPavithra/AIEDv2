
---

## Database Schema Setup

### Custom schema: `aied`
Tables are created in a custom `aied` schema instead of `public`. This keeps them out of Supabase's default REST API auto-exposure. To expose via Supabase REST, `aied` must be added manually under Dashboard → API → Exposed schemas.

The asyncpg pool is configured with `server_settings={"search_path": "aied,public,extensions"}` so all bare table references in SQL resolve to `aied` without explicit prefixing.

---

## Column-Level Encryption

### Requirement
All student PII must be encrypted at the column level such that direct database access (Supabase dashboard, service key, SQL editor) reveals only ciphertext.

### Fields encrypted (stored as `BYTEA`)
| Table | Column(s) |
|---|---|
| `student_profiles` | `target_exam` |
| `student_goals` | `goal_text`, `goal_structured` |
| `goal_chat_history` | `content` |
| `answers` | `answer_text` |
| `answer_behaviour` | `behaviour_label` |
| `evaluations` | `feedback_text`, `concepts_covered`, `concepts_missed`, `hallucination_note` |
| `recommendations` | `reason` |
| `progress_snapshots` | `dominant_behaviour` |

Numeric score fields (`factual_correctness_score`, `distraction_ratio`, etc.) are left unencrypted — SQL aggregations (`AVG`, `SUM`) cannot operate on encrypted values.

### Approach chosen: pgcrypto + Supabase Vault

**Attempt 1 — pgsodium direct (`crypto_aead_det_encrypt`)**
- Error: `relation "pgsodium.valid_key" does not exist`
- Fix attempted: `CREATE EXTENSION IF NOT EXISTS pgsodium`
- Error: `permission denied for function crypto_aead_det_decrypt`
- Fix attempted: `GRANT EXECUTE ON FUNCTION pgsodium.crypto_aead_det_decrypt ... TO postgres`
- Error: `permission denied to grant role "pgsodium_keyiduser"`
- Root cause: Supabase's managed environment does not allow granting the `pgsodium_keyiduser` role from the SQL editor. It is controlled at the infrastructure level. pgsodium direct encryption is not usable without elevated access.

**Approach 2 — pgcrypto + Supabase Vault (adopted)**
- Encryption key generated and stored in Vault: `SELECT vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'student_pii', '...')`
- Vault protects the key using pgsodium internally — key never appears in plaintext in the DB
- Encrypt on write: `pgp_sym_encrypt(plaintext, (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'student_pii'))`
- Decrypt on read: views use `pgp_sym_decrypt(ciphertext, ...)` — application reads from `*_decrypted` views, never base tables
- `vault.decrypted_secrets` is accessible to `service_role` and `postgres` — what the backend uses via DATABASE_URL

### Extension schema issue
- Error: `function pgp_sym_decrypt(bytea, text) does not exist`
- Root cause: Supabase installs extensions in an `extensions` schema. Setting `search_path TO aied, public` dropped `extensions` from the path, making pgcrypto functions invisible.
- Fix: `SET search_path TO aied, public, extensions` — also applied to asyncpg pool `server_settings`.
- Extensions are created with explicit schema: `CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions` to prevent them landing in `aied`.

### Schema ordering issue
- Error: `schema "aied" does not exist` (error code 3F000)
- Root cause: `SET search_path TO aied, public, extensions` was executing before `CREATE SCHEMA IF NOT EXISTS aied`. PostgreSQL validates the schema exists when setting search_path in some contexts.
- Fix: moved `CREATE SCHEMA IF NOT EXISTS aied` to the first statement in the script, before `SET search_path` and before all extensions.

### Vault key idempotency
- Error: `duplicate key value violates unique constraint "secrets_name_idx"`
- Cause: `vault.create_secret` was run a second time after the schema was dropped and recreated. Dropping the `aied` schema does not delete Vault secrets — Vault lives in a separate schema (`vault`).
- Fix: the `vault.create_secret` call is a one-time setup step, documented separately from the main schema script. Never re-run it.

---

## Backend

### Startup
```
cd AIEDv2/backend
uvicorn app.main:app --reload --port 8000
```
Warning at startup (`DB pool unavailable`) is expected when `DATABASE_URL` is not set. The server starts regardless — endpoints that touch the DB will fail until `DATABASE_URL` is populated.

`DATABASE_URL` must be the **Transaction Pooler** connection string from Supabase Dashboard → Project Settings → Database (port 6543, not 5432).

### Auth flow (`/auth/token`)
1. Verifies credentials against Supabase Auth (`/auth/v1/token?grant_type=password`) via httpx — does not require DB pool.
2. Looks up or creates the user row in `aied.users` via Supabase REST API using the service key.
3. Returns a local JWT signed with `JWT_SECRET`.

`/auth/me` requires the DB pool (uses asyncpg directly). Dashboard page will fail until `DATABASE_URL` is set.

### Google embedding deprecation
`google.generativeai` package (`text-embedding-004`) is deprecated as of January 2026. The ingestion service currently imports it and emits a `FutureWarning` at startup. Must be migrated to `google.genai` with model `gemini-embedding-001` (768 dims via `output_dimensionality=768`) before the ingestion feature is built.

`requirements.txt` updated: `google-generativeai>=0.8.0` → `google-genai>=1.0.0`. `openai>=1.73.0` → `openai>=2.0.0` (major version gap, breaking changes in OpenAI SDK v2 must be reviewed before building the Groq fallback path).

**Resolved 2026-07-07:** this migration was never actually done — `ingestion.py`/`rag.py` were still calling the now-fully-retired `models/text-embedding-004` (not a deprecation warning anymore, a hard `404`) when the ingestion feature was finally exercised with a real document. See "Document Ingestion Pipeline Debugging" below.

---

## Dependency Registry
A separate document [`COMPONENTS.md`](COMPONENTS.md) tracks all components, services, and packages with current vs latest versions and required actions.

---

## Frontend

### Spline 3D Background (Landing Page)

**Date:** 2026-06-20

Replaced the WebGL liquid shader background (`LiquidBackground.tsx`) and the dependent glass overlay (`GlassOverlay.tsx`) on the landing page with a Spline 3D scene embedded via iframe.

**Why replaced together:** `GlassOverlay` read pixel data from the `LiquidBackground` canvas via `document.getElementById('liquid-bg')` as a WebGL texture. Without the liquid canvas present, the overlay exits early and renders nothing — so it was removed along with the liquid background.

**Approach — iframe embed (no package install required)**

Spline share URLs (`my.spline.design/{slug}/`) are publicly embeddable. The simplest integration is a full-screen `<iframe>`:

```tsx
// src/components/SplineBackground.tsx
<iframe
  src="https://my.spline.design/untitled-OwO6T4J4xAjEjBbuvvyhRNJ5/"
  title="3D Background"
  frameBorder="0"
  className="fixed inset-0 w-full h-full -z-10"
  style={{ border: 'none', pointerEvents: 'none' }}
/>
```

`pointer-events: none` is required because the landing page uses a custom SVG cursor tracked via `window.addEventListener('mousemove')`. Without it, the iframe captures all mouse events and the cursor stops tracking — mouse events do not propagate from an iframe to the parent frame.

**Trade-off:** With `pointer-events: none`, the Spline scene is non-interactive (no drag/orbit). This is acceptable for a background. If interactivity is needed later, the cursor setup would need to be removed or reworked.

**Alternative considered — `@splinetool/react-spline` package**

The React-native option (`<Spline scene="https://prod.spline.design/{id}/scene.splinecode" />`) gives programmatic access (events, camera control). Skipped because: (1) the prod `.splinecode` URL must be copied from the Spline editor export dialog and is not derivable from the share URL slug alone; (2) the iframe approach achieves the same visual result with zero new dependencies.

**Watermark:** Free Spline scenes render a "Built with Spline" badge in the bottom-right corner. Removing it requires a Spline Pro plan.

---

### Three.js Metallic Balls — Landing Page Background

**Date:** 2026-06-21

The Spline iframe was abandoned in favour of a self-contained Three.js scene. The Spline public embed only provides an iframe URL — the `.splinecode` URL needed by `@splinetool/react-spline` is only available inside the Spline editor under **Export → Web**. The Spline runtime's internal Three.js scene (`app._scene`, `app._camera`) is locked behind private properties and cannot be accessed from React to clone/reposition objects programmatically. Conclusion: if you need more than one object or any programmatic control, build in Three.js directly.

#### What actually makes a metallic ball look metallic

A metallic surface has **no diffuse scattering** — it only reflects. To render it correctly two things are needed:

1. **An environment map (cube map or equirectangular)** — the ball literally reflects its surroundings. Without one, `MeshStandardMaterial` with `metalness: 1` renders pure black regardless of lights. `MeshPhongMaterial` with an `envMap` works without PMREM processing.
2. **A single directional light** for the specular highlight. Multiple bright faces in the env map = multiple highlights = football/patchwork look (wrong).

Reference: *"Create an interactive liquid metal ball"* — creativebloq.com. Key excerpt:
> *"We need to load in a texture cube (or a cube map) to give us the reflections… the sphere will reflect the cube's texture. Black will give us no reflection and white will give us a full reflection."*

#### Physics of one light on a metallic ball

Correct light behaviour (single source):
```
facing light  →  white / very bright
terminator    →  light grey (soft gradient)
mid-shadow    →  dark grey
full shadow   →  black
```
Wrong: multiple bright patches = multiple light sources. `shininess` controls highlight SIZE — low value (10–25) = wide metallic highlight, high value (200+) = tiny plastic dot.

#### Working implementation (current state — "progress" checkpoint)

**Packages installed:**
```
npm install three
npm install --save-dev @types/three
```

**Scene setup:**
```
Camera:  PerspectiveCamera(50°, aspect, 0.1, 100) at z=12
Light:   PointLight(0xffffff, intensity=2, distance=100) at (0, 0, 9)
         — at screen centre, simulating the text as a light bulb
Ambient: AmbientLight(0xffffff, 0.04) — just enough to see dark-side silhouette
```

**Material:**
```ts
new THREE.MeshPhongMaterial({
  color:        0x444444,   // dark grey base — controls reflectivity %
                            // pure black (0x000000) = no env-map reflection visible
  specular:     0xffffff,   // white highlight
  shininess:    80,
  envMap:       cubeMap,    // cube map where +Z face is bright
  combine:      THREE.MixOperation,
  reflectivity: 0.9,        // 90 % of appearance = env-map reflection
})
```

**Cube map (procedural, no image files):**

The +Z face is the camera/text direction. Metallic balls facing the text reflect the +Z face → bright. Balls facing away reflect the -Z face → black.

```ts
// Face order: [ +X, -X, +Y, -Y, +Z, -Z ]
new THREE.CubeTexture([
  face(60,  5),   // +X  dim
  face(60,  5),   // -X  dim
  face(40,  5),   // +Y  dim
  face(20,  5),   // -Y  dim
  face(255, 80),  // +Z  BRIGHT — camera / text direction
  face(5,   5),   // -Z  dark  — back face = shadow
])
```

Each face is a canvas with a radial gradient from `ctr` brightness at the centre to `edg` at the corners (radius = S × √2 / 2 to reach corners and avoid unlit square borders).

**Mouse drag-to-rotate:** `Raycaster.intersectObjects(meshes)` on `mousedown` to pick a ball, then apply `rotation.x/y` delta on `mousemove`. Rotation stops when `mouseup` fires.

**Float animation:** Each ball bobs on `Math.sin(t * 0.45 + phase) * 0.12` in Y with a unique `phase` offset — gives a transverse wave / buoy-on-water feel.

**Ball positions (world space, camera FOV 50° at z=12 → visible x ±9.9, y ±5.6 at z=0):**

| Ball | x | y | r | Note |
|---|---|---|---|---|
| top-right | 7.5 | 4.5 | 2.0 | partially off top-right |
| left small | -8.0 | 0.5 | 0.9 | near left edge |
| right medium | 8.0 | -2.5 | 1.5 | near right edge |
| bottom-left large | -4.5 | -4.5 | 2.4 | partially off bottom |
| bottom tiny | -0.5 | -5.3 | 0.5 | near bottom edge |

All pairs satisfy `dist(centers) > r_i + r_j` (no overlap).

#### What still needs fixing (open issues)

1. **Light direction** — the white reflection spot is not correctly positioned on each ball's text-facing surface. For off-centre balls the reflection direction has a significant X component, but only the +Z cube face is bright. The spot should appear on the side of the ball that directly faces the text (screen centre), not just the camera-facing pole.

2. **Correct approach (not yet implemented)** — use `MeshPhongMaterial` with:
   - ONE `PointLight` at text position only (no env map)
   - `color: 0x2a2a2a` (dark grey for diffuse gradient)
   - `specular: 0xffffff`, `shininess: 15` (wide smooth highlight)
   - This gives the physically correct single-source gradient: white → light grey → dark grey → black, with the highlight automatically facing the light for every ball regardless of position.
   - The env-map approach creates a fixed-world reflection that does not automatically orient per-ball toward the light.

---

## Database Security Hardening (Supabase linter findings)

**Date:** 2026-07-02

### Findings
Supabase's database linter flagged 30 issues on the `aied` schema: RLS disabled on all 17 tables, 8 `*_decrypted` views bypassing RLS (SECURITY DEFINER-style default view behavior), and 6 tables with `session_id` exposed via the Data API without RLS. Root cause: `aied` was added to the Data API's exposed schemas (see line 7 above), but RLS was never enabled on any table.

### Verification before fixing
Traced every DB access path in the backend to confirm the fix wouldn't break the app:
- `asyncpg` pool (`database.py`) connects as the `postgres` role — bypasses RLS by default.
- `auth.py` `/token` login queries `aied.users` directly via `httpx` against `/rest/v1/users`, but always with the **service_role** key (`SUPABASE_SERVICE_KEY`) — also bypasses RLS. The publishable key (`SUPABASE_KEY`) is only ever used as the `apikey` header for the GoTrue `/auth/v1/token` call, never against `aied` tables.
- `documents.py` / `ingestion.py` use `supabase-py` for Storage only (`supabase.storage.*`), never `.table()`/`.from_()`/`.rpc()`.
- Frontend has zero direct Supabase references.

No code path relies on `anon`/`authenticated` Postgres roles reading `aied`. Enabling RLS with no policies is a pure lockdown of unused, previously-exposed API surface.

### Fix
- `schema.sql`: added `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for all 17 tables (no policies — default-deny for anon/authenticated; `postgres`/`service_role` still bypass RLS), and `WITH (security_invoker = true)` on all 8 `*_decrypted` view definitions so they stop bypassing RLS for non-privileged roles. `security_invoker` requires Postgres 15+.
- `security_hardening.sql` (new, repo root of `AIEDv2/`): one-time `ALTER TABLE` / `ALTER VIEW` script to apply the same changes to the already-provisioned live database via the Supabase SQL editor (schema.sql's `CREATE TABLE`/`CREATE VIEW` statements can't be re-run against an existing DB).
- `security_invoker = true` is safe for decryption: the view's `pgp_sym_decrypt(...)` call reads `vault.decrypted_secrets`, which is granted to both `postgres` and `service_role` (see Vault section above) — the only two roles that ever actually query these views.

---

## AI Provider Swap — Claude/Bedrock → Gemini

**Date:** 2026-07-03

### Why
Question generation, answer evaluation, and the goal chatbot ran through AWS Bedrock (`AsyncAnthropicBedrockMantle`) on employer-billed AWS credentials, for what is a personal project. A separate project had already triggered a manager's question over an $80 charge; with no personal budget for Claude API access, all three call sites were moved to Gemini's free tier on a personal Google account — zero shared billing surface with the employer.

### What changed
- `config.py`: `HAIKU_MODEL` + `SONNET_MODEL` (`anthropic.claude-haiku-4-5` / `anthropic.claude-sonnet-4-6`) replaced with a single `GEMINI_MODEL = "gemini-2.5-flash"`.
- `services/generation.py`, `services/evaluation.py`, `routers/goals.py`: `AsyncAnthropicBedrockMantle` calls replaced with `google.genai`'s async client (`client.aio.models.generate_content`). Verified the exact SDK signature against the installed `google-genai==1.24.0` before writing any code — `client.aio` exists, and `GenerateContentConfig` accepts snake_case kwargs (`system_instruction`, `top_p`, `max_output_tokens`, `response_mime_type`) via pydantic alias handling.
- Generation and evaluation calls set `response_mime_type="application/json"`, so Gemini returns clean JSON directly — the markdown-fence-stripping logic from the Claude version is kept only as a defensive fallback, no longer load-bearing.
- Goal chatbot history conversion: Claude's `"assistant"` role maps to Gemini's `"model"` role when building `types.Content`/`types.Part` objects for multi-turn context.
- `routers/evaluations.py`, `routers/sessions.py`: two hardcoded audit-trail values (`model_used`, `evaluator_model` — previously `"claude-haiku-4-5-20251001"` / `SONNET_MODEL`) now reference `GEMINI_MODEL`.
- `main.py` `/health/ai`: the Bedrock ping was replaced with a Gemini generation ping.
- `.env`: AWS Bedrock keys commented out, not deleted — restorable when Claude budget exists.

### Verified before editing
Ran `git check-ignore` and `git log --all -- backend/.env` before touching the file — confirmed `.env` (which had live AWS keys in plaintext) was gitignored and had never been committed. No leak from keys that were already sitting there.

### Left alone (out of scope for this change)
- `anthropic[bedrock]` stays in `requirements.txt` — unused but harmless, kept for an easy revert.
- `hallucination.py` / xAI Grok — untouched.
- AWS fields in `config.py`'s `Settings` class — kept, so restoring Bedrock later is a `.env` change, not a code change.

### Caveat — data policy
`GOOGLE_API_KEY` is still the placeholder value; nothing AI-related works until a real personal-account key from [aistudio.google.com](https://aistudio.google.com) is added. Also: Gemini's **free tier** terms allow Google to use prompt/output data to improve their products (paid tier does not). Fine while the only user is a self-test account — must move to the paid tier (or a different provider) before any real student data flows through this.

---

## Auth Flow Debugging — Missing Endpoint, Broken Schema Routing, CORS Masking

**Date:** 2026-07-06

### Symptom
Browser showed `{"message":"Cannot GET /","error":"Not Found","statusCode":404}` on initial load, then later `Access to fetch ... blocked by CORS policy` on `/auth/me` after login succeeded. Investigation surfaced several unrelated root causes stacked under one confusing initial report — none of them were what they first looked like.

### 1. Port 3000 squatted by an unrelated project (root cause of "Cannot GET /")
`netstat` showed two processes both apparently `LISTENING` on port 3000. One was the actual Vite dev server; the other (identified via `Get-CimInstance Win32_Process -Filter "ProcessId=..."`) was `CRMS/backend/dist/main` — a NestJS build from an unrelated work project (CloudNavision OneDrive path), started days earlier and never stopped. NestJS's default 404 body (`{"statusCode":404,"message":"Cannot GET /","error":"Not Found"}`) is a byte-for-byte match for the reported error. `curl` from the shell reached the correct Vite server the entire time — only the browser's real OS-level connection was being routed to the stale NestJS process. Fixed by killing that specific PID.

### 2. Missing `/auth/register` endpoint
`SignupPage.tsx` called `POST /auth/register`; no such route existed in `app/routers/auth.py` (confirmed via grep + a live 404). Added it, mirroring `/token`'s existing new-user pattern: Supabase Auth signup → app `users` row → local JWT.

### 3. Every Supabase REST call in `auth.py` silently targeted the wrong schema
None of the `httpx` calls to `{SUPABASE_URL}/rest/v1/users` set `Accept-Profile`/`Content-Profile: aied`, so PostgREST resolved them against the default `public` schema — `public.users` doesn't exist, so every lookup/insert failed with `PGRST205`. Worse: the insert calls never checked the response status, so `/token` (and initially the new `/register`) issued a valid JWT for a `user_id` that was never actually written to the database. Reproduced live: a test registration returned `200` with a token, but the corresponding `aied.users` row never existed.

Fixed: added `Accept-Profile: aied` / `Content-Profile: aied` to every Supabase REST header in `auth.py`, and added status-code checks on both insert calls (`register`, `token`'s new-user branch) that now raise a `500` with the real PostgREST error instead of proceeding silently.

**Still blocked, not a code fix:** even with the correct header, inserts get `403 permission denied for schema aied` (Postgres error `42501`) — the schema was added to Supabase's *exposed schemas* (so PostgREST will route to it) but the underlying Postgres role was never `GRANT`ed `USAGE` on it. Requires running this in the Supabase SQL editor (not run by Claude — changes live DB permissions):
```sql
GRANT USAGE ON SCHEMA aied TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA aied TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA aied TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA aied GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA aied GRANT ALL ON SEQUENCES TO service_role;
```

### 4. Supabase "Confirm email" enabled
A freshly registered user got a token immediately from `/register` but couldn't log back in via `/auth/token` until clicking the email confirmation link (`401 Email not confirmed`). Not a bug — a Supabase Auth project setting. Recommended turning it off (Dashboard → Authentication → Providers → Email) while the only user is the developer's own test account.

### 5. CORS errors on `/auth/me` were a symptom, not a CORS misconfiguration
`get_current_user` calls `get_pool()`, which raised a raw `OSError` whenever `DATABASE_URL` was unset. Starlette routes unhandled exceptions through `ServerErrorMiddleware`, which wraps *outside* `CORSMiddleware` — so the error response carried no `Access-Control-Allow-Origin` header, and the browser reported a CORS block instead of the real 500.

Fixed in two places:
- `app/database.py`: `get_pool()` now catches the connection failure and raises `HTTPException(503, ...)` instead of letting the raw `OSError` propagate. `HTTPException` is handled by Starlette's `ExceptionMiddleware`, which *is* wrapped by `CORSMiddleware` — verified live: the 503 response now carries `access-control-allow-origin` correctly, and the browser shows a clean `503` instead of a CORS error.
- `app/main.py`: added a global `@app.exception_handler(Exception)` catch-all as a second line of defense for any *other* unanticipated exception. Confirmed this does **not** get CORS headers either (same middleware-ordering issue, tested directly) — its only value is replacing raw tracebacks with a clean logged error + JSON body. The `get_pool()` fix above is what actually resolves CORS-on-error.

### Still outstanding (superseded — see next entry)
`DATABASE_URL` has not been set in `backend/.env` through this entire debugging session — every DB-touching endpoint (`/auth/me`, `/auth/callback`, all routers) keeps failing (now with a clean 503 instead of a confusing CORS error) until it's populated with the Supabase Transaction Pooler connection string (Project Settings → Database → port 6543). The `aied` schema GRANT above is also still pending.

**Update:** `DATABASE_URL` was never set — instead, `asyncpg` was removed from the backend entirely. See the next entry.

---

## Removed asyncpg/DATABASE_URL Entirely — Completed the Decrypted-View Write Pattern

**Date:** 2026-07-06

### Why
Two things converged: (1) the encryption bug fix above required either raw SQL or database functions regardless of connection method, since the vault key (`vault.decrypted_secrets`) is only reachable from inside Postgres, never via REST; (2) a second project (Sandali's other Supabase project, invoice OCR) already implements the *complete* version of the encrypted-column pattern — base tables store ciphertext, `*_decrypted` views decrypt on read, and critically, `INSTEAD OF INSERT/UPDATE` triggers on those views encrypt on write, so the app only ever talks to the views via the Supabase REST API. AIEDv2's schema had only the read half of that pattern (the views existed, confirmed via `grep` for `INSTEAD OF` — zero matches). The write half was always the actual gap, not a reason to keep `asyncpg`.

### What changed

**New file — `decrypted_view_writes_and_rpc.sql`** (repo root, run once in the Supabase SQL editor):
- `INSTEAD OF INSERT` triggers (and `UPDATE` where the app upserts) for all 7 tables with encrypted columns: `answers_decrypted`, `answer_behaviour_decrypted`, `evaluations_decrypted`, `goal_chat_history_decrypted`, `student_goals_decrypted`, `recommendations_decrypted`, `progress_snapshots_decrypted`. Each trigger function is `SECURITY DEFINER`, so it runs with the schema-owner's privileges (vault access, base-table writes) regardless of the calling role's own grants.
- Upsert semantics (`answer_behaviour` on `answer_id`, `progress_snapshots` on `(user_id, topic_id, snapshot_date)`) are implemented **inside** the trigger function via `INSERT ... ON CONFLICT ... DO UPDATE` against the base table — a view can't take an `ON CONFLICT` clause directly, so the view-level statement is always a plain `INSERT`, and the trigger decides whether that becomes an insert or update on the real table.
- 5 new RPC functions (`POST /rest/v1/rpc/<name>`) for the SQL that has nothing to do with encryption and was never expressible through PostgREST's URL filter syntax: `hybrid_search` (pgvector `<=>` operator + computed ranking), `find_best_chunk_for_concepts` (full-text `ts_rank`), `session_avg_final_score` and `topic_progress_stats` (multi-table `JOIN`+`AVG`/`GROUP BY` aggregates), `record_document_access` (atomic counter increment on conflict — `Prefer: resolution=merge-duplicates` can only overwrite fields, not increment them).
- `topic_progress_stats` also fixes a correctness issue found while writing it: the original `_snapshot_progress` grouped on `behaviour_label` directly from the base (encrypted) table — `pgp_sym_encrypt` is non-deterministic, so two rows with the same plaintext label would never produce equal ciphertext and the `GROUP BY` would never actually group anything. The RPC groups on `answer_behaviour_decrypted` instead.
- Every new view/function has an explicit `GRANT` to `service_role`. Also re-stated `GRANT USAGE ON SCHEMA aied TO service_role` (the fix from the previous entry) since nothing in this schema is reachable without it, views and functions included.

**New file — `backend/app/supabase_rest.py`**: a small shared PostgREST client (`rest_get`, `rest_get_one`, `rest_post`, `rest_post_one`, `rest_patch`, `rest_delete`, `rest_rpc`). Centralizes the `Accept-Profile`/`Content-Profile: aied` headers and the CORS-safe error handling from the previous entry (network/non-2xx responses raise `HTTPException`, not a raw `httpx` exception) so every call site gets it for free instead of re-implementing it.

**Every router and service rewritten off `asyncpg`:** `auth.py` (both the dependency and the router), `answers.py`, `evaluations.py`, `sessions.py`, `goals.py`, `recommendations.py` (router + service), `progress.py`, `topics.py`, `documents.py`, `services/rag.py`, `services/ingestion.py`. Encrypted-table writes now POST plaintext directly to the `*_decrypted` views (the trigger encrypts transparently); everything else uses plain REST filters or the new RPC functions.

**Removed:** `get_pool()`/`close_pool()` and the FastAPI `lifespan` DB-pool management (`app/database.py`, `app/main.py`); `DATABASE_URL` from `Settings` (`app/config.py`); `asyncpg` from `requirements.txt`. `app/database.py` now only exports `get_supabase()` (Storage signed URLs).

**`/health`** (`app/main.py`) now probes Supabase REST (`SELECT id FROM topics LIMIT 1`) instead of an asyncpg connection.

### Judgment calls
- The pgvector embedding is passed to `hybrid_search` as text (`"[0.1,0.2,...]"`) and cast with `::vector` inside the SQL function, matching the string-building approach `ingestion.py` already used for the direct-SQL insert — not a JSON array coerced by PostgREST, which would have been unverified behavior with no way to test it before landing.
- `ingestion.py`'s chunk insert stayed as a per-chunk REST POST loop rather than one bulk array insert, to avoid an untested large-payload risk on big textbooks (some run to ~800 chunks).
- `documents.py`'s `my-library` endpoint fetches `user_documents` and `documents` separately and merges in Python, rather than relying on PostgREST's embedded-resource join syntax (`select=...,documents(...)`)  — same reasoning: unverified against this project's actual FK setup, and a plain two-step fetch is simple enough to be obviously correct instead.

### Verified before/after
- Every changed file byte-compiles (`python -m py_compile`).
- `grep -rn "asyncpg\|get_pool\|close_pool" app` returns zero code matches (only comments referencing the old name for context).
- Started a live instance against the real Supabase project: `GET /health` returns `{"status":"ok", ...}` via REST — confirms the `GRANT USAGE ON SCHEMA aied` from the previous entry is already in effect. `GET /` still returns FastAPI's plain `{"detail":"Not Found"}` — no regression from the CORS-fix entry.
- Not yet verified live (blocked on `decrypted_view_writes_and_rpc.sql` actually being run against the project): the encrypted-write triggers, the 5 RPC functions, and `record_document_access`. All the SQL and Python code exists and compiles; the SQL file itself is the remaining action item.

### Still outstanding
Run `decrypted_view_writes_and_rpc.sql` in the Supabase SQL editor. Until then, reads that only touch already-granted plain tables/views (e.g. `/health`, `/topics`) work; writes to any encrypted table and any RPC-backed query (hybrid search, session completion, progress snapshots, document view/download tracking) will fail because the functions/triggers don't exist in the database yet.

---

## Generation (Quiz) Dashboard

**Date:** 2026-07-06

### Why
First of three student-facing dashboards (Generation → Evaluation → Recommendations, built in that dependency order — see design spec `docs/superpowers/specs/2026-07-06-generation-quiz-dashboard-design.md`). Generation is a pure quiz: no feedback during the quiz, no chat. While the student answers, the frontend silently records behavioural telemetry (focus/blur, hesitation, revisions, mouse activity, MCQ hover/switching) that the not-yet-built Evaluation phase will use alongside raw answer text to produce a qualitative assessment, not just a correctness score.

### What changed

**Schema (`add_mcq_and_behaviour_columns.sql`, new file, run once after `decrypted_view_writes_and_rpc.sql`):**
- `questions.options jsonb` + `questions.correct_index int` — MCQ-only, nullable. `correct_index` is written by generation but never returned by the quiz-facing endpoint (see below) — it's read later by Evaluation for grading.
- `answer_behaviour.mouse_activity_count int` + `answer_behaviour.option_hover_count int`.
- `question_events`'s `event_type` CHECK constraint extended with `mouse_activity`, `option_hover_start`, `option_hover_end` (dropped and recreated under Postgres's default inline-constraint name, `question_events_event_type_check`).
- `answer_behaviour_decrypted` view and its `INSTEAD OF INSERT` trigger function updated to pass the two new plain (non-encrypted) columns through — new columns appended at the end since `CREATE OR REPLACE VIEW` can't reorder existing output columns.

**Backend:**
- `services/generation.py`: `GENERATION_SYSTEM_PROMPT` now asks for MCQ `options`/`correct_index` as structured JSON fields instead of embedding options as text inside `question_text`.
- `routers/sessions.py`: `_generate_session_questions` inserts `options`/`correct_index`; `get_session_questions` (the quiz-facing endpoint) uses an explicit `select` field list that deliberately omits `correct_index` — the only place in the codebase that answer key exists is inside `questions`, never in a response model the frontend can see.
- `models/question.py`: `QuestionResponse` gains `options: list[str] | None`. No `correct_index` field on this model at all, by design — it can't leak by accident later since the type doesn't carry it.
- `services/behaviour.py`: `compute_behaviour()` tallies `mouse_activity` and `option_hover_start` events into the two new counts. The existing rule-based `behaviour_label` thresholds are untouched — richer interpretation of these new signals is Evaluation's job, not this phase's.
- `models/answer.py` / `routers/answers.py`: `BehaviourResponse` and the `answer_behaviour_decrypted` insert payload carry the two new counts through.

**Frontend (new):**
- `hooks/useQuizSession.ts` — owns all non-visual quiz logic: session creation, polling `GET /sessions/{id}/questions` (2s interval, 45s timeout), current-question tracking, the behavioural event buffer (window focus/blur, throttled `mousemove` → `mouse_activity` at most 1/2s, debounced text-input → `keystroke_start`/`edit`, MCQ selection change → `keystroke_start`/`edit`, option hover → `option_hover_start`/`option_hover_end`), answer+event submission with one automatic retry, and session completion.
- `components/quiz/QuizSetupForm.tsx`, `GeneratingScreen.tsx`, `QuestionCard.tsx`, `QuizComplete.tsx`.
- `pages/GenerationPage.tsx` — phase state machine (`setup → generating → quiz → complete`), routed at `/generate`; linked from a new "Start a quiz" button on `DashboardPage.tsx`.

### Judgment calls
- MCQ selection changes reuse the existing `edit` event type rather than a new one — a changed selection is conceptually a revision, identical to editing a text answer, so `revision_count` works unchanged for both question types with zero new logic in `compute_behaviour()`.
- Text-input telemetry is debounced 800ms after the user stops typing (rather than firing on every keystroke) so `revision_count` reflects distinct correction passes, not raw keystroke volume.
- Added `frontend/src/vite-env.d.ts` (`/// <reference types="vite/client" />`) — this was a pre-existing gap (every file using `import.meta.env.VITE_API_URL` was failing `tsc --noEmit`, including files this feature didn't touch); fixed since the new hook hit the same error and the fix is a single standard file with no behavioral change.

### Verified before/after
- `tsc --noEmit` (`npm run lint`) and `vite build` both pass clean in `frontend/`.
- `python -c "import app.main"` succeeds in `backend/`.
- Confirmed live against the running `--reload` backend instance: `GET /openapi.json`'s `QuestionResponse` schema now includes `options` (and not `correct_index`) without a reload crash.
- Not yet run: `add_mcq_and_behaviour_columns.sql` against the live Supabase project (manual step, same as the still-outstanding item above) — until it's run, session creation will fail wherever `_generate_session_questions` tries to insert into the new `options`/`correct_index` columns.
- Not yet manually walked through in a browser: the frontend dev server on port 3000 returned 404 for every route (including the pre-existing `/dashboard`) during this session's verification pass — appears unrelated to this feature (pre-existing/stale dev server state, two separate node processes were found bound to port 3000), flagged to the user rather than restarting processes unprompted.

---

## Document Upload Dashboard & Live Backend Log

**Date:** 2026-07-07

### Why
The backend already had everything needed to upload and ingest a textbook (`POST /documents/` in `routers/documents.py`, the full pipeline in `services/ingestion.py`) — it just had zero frontend. Separately, the user asked for visibility into what the backend is actually doing during a long-running operation ("like an Azure log with errors and everything") — appropriate for a personal/uni project where a real observability stack is overkill but opaque background tasks are frustrating to debug blind.

### What was added

**Backend — admin document management:**
- `GET /documents/admin` — every document regardless of `ingestion_status` (the existing `GET /documents/` filters to `complete` only, for the student-facing library view — left untouched).
- `GET /documents/{doc_id}` — single-document status, for polling after upload.
- `POST /documents/{doc_id}/retry` — re-runs `ingest_document` for a document already sitting in Storage, without re-uploading the file. Added after a failed ingestion needed re-running twice in one session (see next entry) — re-uploading an 11–20MB file each time to re-trigger a bug fix would have been needlessly slow.

**Backend — live log streaming (`app/log_stream.py`, new):**
- In-memory pub/sub: a `BroadcastHandler(logging.Handler)` fans out every formatted log line to a set of `asyncio.Queue` subscribers. Wired into `setup_logging()` (`logging_config.py`) alongside the existing stdout handler — every log call already in the codebase is now also broadcast live, with zero call-site changes.
- `GET /logs/stream` (`routers/logs.py`, admin-only) — Server-Sent Events, one queue per connected client, 15s keep-alive comments so idle connections don't get dropped.
- Deliberately **not** using the browser's native `EventSource` API — it can't send custom headers, which would have forced passing the JWT as a query parameter (leaks into server/proxy logs and browser history). The frontend instead uses `fetch` + a manual `ReadableStream` reader to parse the SSE format itself, keeping the same `Authorization: Bearer` header pattern used everywhere else in the app.
- Added logging calls throughout `ingestion.py`, which previously had none at all — download progress, per-25-pages extraction progress, chunking summary (token count → chunk count), per-chunk embedding progress (`chunk N/total`, page range, chapter), completion, and failure with full traceback. This is what actually makes the live log useful rather than just an empty pipe.

**Frontend:**
- `pages/UploadPage.tsx` (admin-only, route `/upload`) — upload form (title/author/type/difficulty/topic/file) + a history list polling `GET /documents/admin`.
- First iteration: a `LiveLogPanel` embedded directly in `DashboardPage.tsx` behind a show/hide button. **Revised** after feedback — the user wanted devtools-style behavior: a panel that stays open and connected across page navigation, not something that unmounts the moment you leave one page. Rebuilt as `components/AppShell.tsx` (wraps `<Routes>` in `main.tsx`, so it never unmounts on navigation) + `components/LiveLogSidebar.tsx` (a 440px left-docked panel that pushes page content over via `margin-left`, exactly like a docked browser DevTools panel, with a persistent top-left toggle button visible on every route). `AppShell` re-checks admin status on every `location.pathname` change (not just once at mount) so the toggle appears/disappears immediately around login/logout without a full page reload.

### Verified before/after
- `tsc --noEmit` and `python -c "import app.main"` both clean after every change in this entry.
- Live end-to-end: connected to `/logs/stream` with a minted admin JWT via curl, triggered a `/topics/` request in parallel, confirmed both the stream's own connection log line and the triggered request appeared in the SSE output within the same second.

---

## CORS-Masking Bug, Round 2 — the Catch-All Handler Was Never Actually Fixed

**Date:** 2026-07-07

### Why this came back
The 2026-07-06 "Auth Flow Debugging" entry fixed the *specific* case it was chasing (`get_pool()`'s raw `OSError`) by converting it to an `HTTPException`, and added `@app.exception_handler(Exception)` as a stated "second line of defense" — but that entry's own verification step confirmed the catch-all **did not** get CORS headers, and left it as a known gap rather than fixing it. This session hit that exact gap for real: a genuine unhandled exception during document upload (see next entry) bypassed CORS again, and the browser reported a masking "CORS blocked" error instead of the real `500`.

### Root cause, precisely
Starlette's `Starlette.build_middleware_stack()` special-cases any exception handler registered for the bare `Exception` class (or the `500` status code): instead of running through the same `ExceptionMiddleware` that handles `HTTPException` and other specific types, it gets hoisted into `ServerErrorMiddleware` — which is unconditionally the **outermost** layer, wrapping every user-added middleware including `CORSMiddleware`. No amount of `add_middleware()` reordering fixes this; the response from this handler physically never passes through `CORSMiddleware`.

### Fix
`main.py`'s `unhandled_exception_handler` now builds its `Access-Control-Allow-Origin`/`Access-Control-Allow-Credentials` headers by hand, checking the request's `Origin` header against the same `origins` list `CORSMiddleware` was configured with, and attaches them directly to the `JSONResponse` it returns. Verified live: a deliberately-triggered `502` (see next entry) came back with the correct `access-control-allow-origin` header and a readable `detail` message instead of an opaque CORS error.

---

## Document Ingestion Pipeline Debugging — Four Independent Bugs, Found Live via the New Log

**Date:** 2026-07-07

### Why these went undetected until now
Every previously-verified flow (auth, quiz generation/answering) never touches Supabase Storage or calls the embedding API — quiz generation retrieves *existing* chunks via `hybrid_search`, it doesn't create new ones. The first real textbook upload (an ~20MB, 1,151-page PDF) was also the first time this session's code ever exercised the Storage upload path or the embedding call at all.

### 1. `get_supabase()` built a malformed Storage URL
`SUPABASE_URL` is configured with a `/rest/v1/` suffix (required by `supabase_rest.py`'s hand-rolled PostgREST client, which strips it before use). `database.py`'s `get_supabase()` passed that same suffixed URL straight into `create_client()`. `supabase-py`'s Storage sub-client appends its own `/storage/v1/` onto whatever base URL it's given, with no normalization — producing `https://…/rest/v1//storage/v1/object/…`, a path that doesn't reach the Storage service.

This is also almost certainly *why* the underlying `storage3` library crashed with `KeyError: 'error'` instead of a clean error message — the malformed path likely got intercepted by the PostgREST gateway (it starts with `/rest/v1/`) before ever reaching Storage, so the 404 body that came back didn't have the shape (`{message, error, statusCode}`) `storage3`'s error constructor expects.

Confirmed directly (not guessed) by inspecting `sb.storage._client.base_url` before and after the fix. Fixed by stripping `/rest/v1` in `database.py`, mirroring the existing normalization in `supabase_rest.py`.

### 2. The `documents` Storage bucket had never been created
Confirmed via a direct `GET /storage/v1/bucket` call returning `[]`. Not a code bug — a one-time manual step (Supabase Dashboard → Storage → New bucket → name `documents`, private, no policies needed since the backend uses the service-role key).

### 3. `text-embedding-004` is fully retired
The first real embedding call returned `404 NOT_FOUND` ("is not found ... or is not supported for embedContent"). Rather than guess a replacement model name from training data, queried the API key's actually-available models live (`client.models.list()`, filtered for `embedContent` support): `gemini-embedding-001`, `gemini-embedding-2`, `gemini-embedding-2-preview`. `gemini-embedding-001` defaults to **3072** dimensions — the schema's `document_chunks.embedding` is `VECTOR(768)`. Tested `output_dimensionality: 768` directly before committing to it; confirmed it truncates cleanly with no schema migration needed.

Fixed in `config.py` (`EMBEDDING_MODEL`) and both call sites — `ingestion.py` (document-side) and `rag.py` (query-side, `hybrid_search`'s embedder). Both must use the same model/dimensionality or search silently degrades (comparing embeddings from different models is meaningless, not an error). Consolidated the previously copy-pasted `_get_google_client()`/embed logic from both files into a new shared `app/services/embedding.py`. This closes the "Google embedding deprecation" item flagged back on the schema-setup entry above, which had warned this migration was needed "before the ingestion feature is built" — it wasn't done at the time, and this is the bug that resulted.

### 4. Free-tier rate limit killed the run partway through
`429 RESOURCE_EXHAUSTED` hit around chunk 30 of 1,249. Before writing a fix, confirmed live (a manual embed call succeeded roughly 2 minutes after the failure) that this is a **per-minute** quota, not a daily cap — retrying against a daily cap would just waste time with no chance of success. `app/services/embedding.py`'s `embed()` now retries on `429` specifically with exponential backoff (5s → 10s → 20s → 40s → 60s cap, 6 attempts) before giving up.

### Related correctness fix: retries were duplicating chunks
Re-running `ingest_document` after a partial failure re-embedded and re-inserted every chunk that had already succeeded (chunks 1–29 from the first failed attempt), because `document_chunks` has no unique constraint on `(document_id, chunk_index)`. Confirmed the 33 leftover rows existed via a direct query before fixing. `ingest_document` now deletes any existing chunks for the document at the start of every run, making retries idempotent — verified the delete actually has permission to run (rather than assuming from a stale memory of the grants file, which turned out to be wrong) by running it directly against the live leftover rows.

### A retry that would have run invisibly
First instinct was to re-trigger `ingest_document` via a standalone one-off script. Caught before running it fully: a standalone script is a separate OS process with its own in-memory `log_stream._subscribers` set, completely disconnected from the running server's — it would have ingested the whole book with zero output in the live log panel, silently defeating the entire point of the feature just built. This is why `POST /documents/{doc_id}/retry` exists as a real endpoint instead — it runs inside the actual server process, so its log lines reach the same broadcaster real requests do.

### Verified before/after
- Each fix confirmed individually and live before moving to the next (model list, `output_dimensionality` truncation, rate-limit recovery timing, delete permission) rather than batching untested assumptions.
- `python -c "import app.main"` clean after every change.
- Final state watched live end-to-end via the new log stream through chunking (1,249 chunks confirmed) and into the embedding/rate-limit-retry loop.

---

## Recurring Issue: Windows `uvicorn --reload` Leaves Orphaned Processes

**Observed repeatedly across 2026-07-06 and 2026-07-07.**

Killing a `uvicorn --reload` parent (the "reloader" process in its own log line) does not reliably kill its spawned worker child — Windows has no equivalent of POSIX process-group teardown here, so the child survives independently, keeps `LISTENING` on the port, and keeps serving requests using whatever code/config it loaded at *its own* startup. This produced real confusion multiple times: a `.env` change appeared to have no effect because a stale orphaned worker (not the freshly-started one) was the process actually answering requests, and its "uptime" only becomes visible as a lie when checked against `GET /health`'s `uptime_seconds`.

Separately: two independent `uvicorn` invocations (one from Claude, one from the user's own terminal) can both end up `LISTENING` on the same port per `netstat`, with no reliable way to predict which one the OS routes a given connection to. The same pattern hit the frontend `vite` dev server — a second `npm run dev` auto-increments to the next free port (e.g. 9203 → 9204) instead of failing, silently creating a second live instance.

**Working pattern adopted:** before any restart, enumerate every live instance first — `Get-CimInstance Win32_Process -Filter "Name='python3.11.exe'"` (or `node.exe`) and inspect `CommandLine`/`ParentProcessId`/`CreationDate` — never trust the PID from the last-seen `Started reloader process [...]` log line as the only one alive. Kill everything found, start exactly one fresh instance, and confirm via `GET /health`'s `uptime_seconds` that the process now answering is actually the new one (a small number), not a survivor.

**Escalation, same day:** repeated backend restarts (some by Claude, some by the user, per the pattern above) turned out to be actively harmful, not just confusing — see "Ingestion Status Can Lie" below. Resolution: Claude no longer starts/restarts the backend at all; the user runs `uvicorn` themselves from their own terminal. See `feedback_backend_process_control` in Claude's memory.

---

## Ingestion Status Can Lie — `ingestion_status` Had No Connection to Reality

**Date:** 2026-07-07

### The problem, as the user put it
After ending a terminal session mid-ingestion (twice), then clicking the newly-added Retry button twice because the live log wasn't clearly confirming the first click had taken effect, a document sat showing `PROCESSING` in the UI with a freshly-started backend that had done nothing but serve login/topics requests — no `[ingestion.py]` log lines at all. Nothing was actually running, but the UI said otherwise. As stated directly: *"The system don't get to decide that this should be reprocessed or not. Retried or not. I do. I tell the system that."*

### Root cause
`ingestion_status` is written by a `BackgroundTasks` coroutine that lives entirely in one process's memory. If that process dies — killed terminal, crash, manual restart — the coroutine just stops existing. Nothing patches the row to `failed`, because the code that would do that (the `except` block) never runs; a hard process death skips it entirely. The field freezes at whatever it last said, permanently, with zero connection to whether anything is actually running. This happened twice in this session alone (once from Claude force-killing a process, once from the user ending a session mid-task) and was fixed by hand each time via a one-off script — not a sustainable pattern.

### Fix — two changes, not one
1. **Startup reconciliation** (`main.py`, `@app.on_event("startup")`): a cold process start has exactly zero in-memory background tasks. This is not a heuristic — it's certain. So any document still marked `pending`/`processing` from before that boot is unconditionally stale and gets flipped to `failed` immediately, every time the app starts.
2. **Duplicate-trigger guard** (`routers/documents.py`): `POST /documents/{id}/retry` now rejects with `409` if `ingestion_status == "processing"`. This only becomes meaningful *because* of fix #1 — without startup reconciliation, "processing" could already be a lie, and gating on a lie protects nothing. With it, "processing" can only mean a task is genuinely alive in the current process, so blocking a second concurrent trigger is trustworthy.

Net effect: a status transition only ever happens because of an explicit action (upload, retry) or a provably-safe correction (startup reconciliation) — never as a side effect of a process silently dying.

---

## Embeddings Moved Off Gemini Entirely — Local BAAI/bge-base-en-v1.5

**Date:** 2026-07-07

### Why
The daily-quota fast-fail (previous entries) correctly stopped the pipeline from wasting time retrying against a wall that wouldn't clear until midnight Pacific — but it didn't remove the wall itself. A single ~1,151-page textbook (1,249 chunks) alone approaches the free tier's `EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier` cap of 1,000/day, and iterative development (re-running ingestion, diagnostic probes) eats into the same shared quota. Two options were considered: rotating multiple Google accounts/API keys for more combined quota, or a local open-source model. The first was rejected — deliberately creating multiple accounts to get around a rate limit is quota circumvention against Google's ToS, not a technical fix, and it only multiplies a still-finite ceiling rather than removing the constraint. The second was chosen.

### Model selection
Rather than default to whichever model came to mind first, checked current comparative data (MTEB-adjacent sources, mid-2026) before picking. Ruled out **BGE-M3** despite most 2026 sources calling it "the default" — it outputs **1024** dimensions (mismatch against the fixed `VECTOR(768)` schema) and is built for 100+-language coverage this English-only corpus doesn't need; that advice is aimed at GPU-scale multilingual production, not this case. Landed on **`BAAI/bge-base-en-v1.5`**: native 768-dim (exact schema match, no truncation trick needed, unlike Gemini's `output_dimensionality`), ~109M parameters (small, fast even on CPU), and — critically — asymmetric by design (an instruction prefix on queries only, none on passages), which maps directly onto the `task_type` split (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`) the code already had, so no architectural rework was needed, just a different implementation behind the same `embed(text, task_type)` interface. `intfloat/e5-base-v2` was noted as an equally valid alternative with a different prefix convention, if ever revisited.

### What changed
- `app/services/embedding.py`: rewritten from a Gemini API client (with retry/backoff/daily-quota-detection — all now dead code, since a local model has no rate limits at all) to `sentence_transformers.SentenceTransformer('BAAI/bge-base-en-v1.5')`. `encode()` is a blocking CPU/GPU call, so it runs via `asyncio.to_thread` to keep the event loop free during a long ingestion run (live log stream, other requests) — same public `async def embed(text, task_type)` signature, so `ingestion.py` and `rag.py` needed zero changes beyond the import.
- `app/config.py`: `EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"`. `EMBEDDING_DIMENSIONS = 768` unchanged (now a native match, not a truncation target).
- `requirements.txt`: added `sentence-transformers>=3.0.0` (pulls in `torch`, already present in this environment as a CUDA 12.1 build).
- Manually verified all 766 chunks already embedded via Gemini were deleted (`DELETE FROM aied.document_chunks;` — confirmed zero `questions`/`recommendations` rows referenced any of them first, so no FK cascade concerns) — embeddings from two different models are not comparable, so a from-scratch re-embed was required, not optional.

### Verified before/after
- `python -c "import app.main"` clean.
- Live sanity test discovered a bonus: this machine has a real NVIDIA RTX 4060 Laptop GPU, and `sentence-transformers` auto-detected and used it. First call (model download + load): ~55s one-time. Every call after: **~8ms/chunk** — roughly 100-150x faster than Gemini's ~1-1.2s/chunk network round trip, with no rate limit of any kind.
- Confirmed 768-dim output on both the document-embedding path (`services/embedding.py` directly) and the query-embedding path (`rag.py`'s `embed_text`, used by `hybrid_search`) — both must produce vectors from the same model or search silently degrades.

### Explicitly not done
Did not also switch the generation model (Gemini 2.5 Flash, used for question generation/evaluation/goal chat) to an open-source alternative. Confirmed first (not assumed) that `embedContent`'s daily quota is tracked separately from `generateContent`'s — the exhausted quota's own name (`...PerModel-FreeTier`) says so directly, and no generation calls happened today at all. Swapping working, unaffected infrastructure to fix a problem that was actually scoped to a different model would have been solving a hypothetical. If `generateContent` ever genuinely hits its own limit, `Qwen3 32B via Groq` already exists as a documented fallback pattern in this codebase (`COMPONENTS.md`) — that's the path to revisit it, not a preemptive swap today.

---

## The Live Log Feature Was Deadlocking the Entire Server

**Date:** 2026-07-07

### Symptom
First real quiz-generation attempt appeared to hang forever on "Generating your quiz…" even after the underlying difficulty-mismatch issue (previous entry) was fixed and confirmed working server-side (all 5 questions existed in the database). The frontend never advanced. Investigating live: `GET /sessions/{id}/questions` hung with no response at all — not an error, a genuine hang, confirmed with `curl --max-time`. Escalated the check to `GET /health`, the simplest possible endpoint in the app: it hung too. This wasn't a bug in quiz generation, retrieval, or the frontend poll — the **entire backend process** was deadlocked.

### Root cause
`RequestLoggingMiddleware` was built on Starlette's `BaseHTTPMiddleware`, which has a well-documented architectural issue: it bridges the downstream response through an internal task group, and that bridging can deadlock the whole event loop when a long-lived streaming response is active — which is exactly what `GET /logs/stream` (the live log SSE feed) is. With the live log panel open (as it was, showing the very generation attempt being debugged), every other request on the same process — including `/health` — could hang indefinitely behind it.

This means the debugging tool built earlier today to make failures more visible was, under exactly the condition it's meant to be used (kept open while watching a live operation), capable of freezing the entire application. Not a coincidence that this surfaced today rather than earlier — this was the first time a long *and* real user-driven operation (quiz generation, ~25s) ran with the log panel open and connected the whole time, rather than short-lived diagnostic script calls that don't hold the stream open.

### Fix
Rewrote `RequestLoggingMiddleware` (`logging_config.py`) as plain ASGI middleware (`__init__(self, app)` / `async def __call__(self, scope, receive, send)`) instead of a `BaseHTTPMiddleware` subclass. Plain ASGI middleware wraps `send` directly and never buffers or bridges the response body through a separate task group — so it has no dependency on how long the downstream response takes to fully complete, streaming or not. Response timing/headers (`X-Request-ID`, `X-Response-Time-Ms`) are now set the moment `http.response.start` is sent (still accurate — that's the same point the old code effectively measured up to), and the summary log line fires after the full ASGI call returns, same as before.

### Verified before/after
- `python -c "import app.main"` clean.
- Built an isolated in-process test (a throwaway Starlette app with a genuinely long-lived streaming endpoint, wrapped in the real `RequestLoggingMiddleware`, driven via `httpx.ASGITransport` — no server process started): with the stream held open, three separate concurrent requests to a plain JSON endpoint all completed in **0.00s each**. That's the exact property that was broken — proven directly, not inferred from the fix "looking right."
- Did *not* fix by making the /logs/stream endpoint's `is_disconnected()` polling less frequent or similar — that would have reduced the odds of hitting the deadlock without addressing why `BaseHTTPMiddleware` can hang at all. Root-caused to the middleware base class itself instead.

---

## Quiz Generation Silently Produced Zero Questions — Difficulty Mismatch + a Real Silent-Failure Bug

**Date:** 2026-07-07

### Symptom
First real end-to-end quiz attempt (after the `add_mcq_and_behaviour_columns.sql` migration was finally run, fixing an unrelated `400` on the questions endpoint) hit the frontend's 45s generation timeout. No error anywhere — the live log showed nothing but the frontend's own polling requests succeeding with empty results.

### Root cause
Book1 was uploaded with difficulty `medium` for the whole document, so all 1,249 chunks carry `difficulty='medium'` (confirmed directly: 0 chunks at `easy`, 0 at `hard`). The quiz was set up with difficulty `easy`. `hybrid_search` correctly filters by exact difficulty match, found zero chunks, and `_generate_session_questions`'s loop had nothing to iterate — zero questions generated. This is not a bug in retrieval or generation, just a real content gap (this book only has one difficulty tier of ingested chunks) — but it failed **completely silently**, with no signal anywhere that this was the reason.

### The actual bug: a bare `except Exception: continue` with no logging
Separately, and worse: the per-chunk generation loop swallowed *any* exception from `generate_question()` with zero logging. Verified `generate_question()` works correctly in isolation (successfully generated a real MCQ from a real chunk) — so the silent-`except` wasn't the proximate cause this time, but it's a real landmine: if it ever does fail for a genuine reason (Gemini error, malformed response, etc.), there would be zero way to know without manually reproducing it call-by-call, exactly as had to be done here.

### Fix
Added logging throughout `_generate_session_questions` (`routers/sessions.py`): session/topic/params on entry, chunk count found by `hybrid_search` (with an explicit warning if zero — the exact case that just happened), a full traceback via `logger.exception` instead of silently swallowing per-chunk failures, and a final `generated N/total` summary. No functional change to what gets generated — this only makes an already-possible failure mode visible in the live log instead of indistinguishable from "still working."

### Not fixed (by design, for now)
Nothing prevents selecting a difficulty with zero matching ingested content — the setup form doesn't know what difficulties actually exist in the corpus. Left alone: this is a one-book, single-difficulty-tier dev-stage state, and building difficulty-aware form validation now would be solving for a corpus that doesn't reflect real usage yet.

---

## The Bigger Freezing Culprit: Blocking Sync Calls Directly on the Event Loop

**Date:** 2026-07-07

### Why this is a separate entry from the BaseHTTPMiddleware fix above
That fix only mattered when the live log panel happened to be open and connected. The user reported the backend "gets frozen up a lot" as an ongoing pattern, not a one-off — which meant there was almost certainly a second, more frequent cause. There was: several genuinely blocking, synchronous calls sat directly on the event loop with no `await`, in the two heaviest-used endpoints (document upload, ingestion). Every single upload/ingestion run was freezing the *entire* server, log panel or not — this fully explains the recurring pattern the middleware bug alone didn't.

### Root cause
FastAPI's concurrency model only works if every request handler either does real `await`-able I/O or explicitly hands CPU/blocking work off to a thread. Several spots did neither:
- `services/ingestion.py`: `supabase.storage....download()` (network, several seconds for a large PDF), `pdfplumber.open()` + the full per-page text-extraction loop (confirmed ~90+ seconds wall-clock on a 1,151-page book), and the tokenizing/chunking pass — all called directly inside `async def ingest_document`, none of it behind an `await`.
- `routers/documents.py`: the Storage `.upload()` call in `upload_document` (blocking for the full upload duration, and this one happens *during the HTTP request itself*, not even in the background task), plus both `.create_signed_url()` calls in `view_document`/`download_document`.

Every one of these blocks the single-threaded asyncio event loop for its full duration — during which the process cannot serve *any* other request, including `/health`. A 90-second PDF extraction meant a 90-second window where the entire backend was unusable for anything, by anyone, for any reason.

### Fix
Wrapped every one of the above in `asyncio.to_thread`, which runs the blocking call in a worker thread and frees the event loop to keep serving other requests concurrently. Consolidated `ingestion.py`'s download/extract/detect-structure/tokenize/chunk sequence into one `_download_and_prepare_chunks()` function and offloaded it as a single `asyncio.to_thread` call, rather than threading each sub-step separately — it's one continuous synchronous pipeline with nothing to interleave internally anyway, so one thread hop is both correct and cheaper than several. Progress logging inside that function is unaffected (Python's `logging` module is thread-safe) — it still fires exactly as before, just from a worker thread instead of the event loop thread, which is invisible to anything reading the log.

### Verified before/after
- `python -c "import app.main"` clean.
- Proved the underlying mechanism directly rather than trusting "`asyncio.to_thread` is the standard fix" on faith: a minimal repro (a 2-second blocking call run via `asyncio.gather` alongside a coroutine pinging every 0.2s) showed all 8 pings landing exactly on schedule *during* the blocking call, with total wall time matching the blocking call's duration rather than the sum — confirming genuine concurrency, not serialization.
- Not independently re-verified against a live, multi-minute real ingestion run in this session (that would require restarting the backend, which is the user's action to take) — the fix is the same well-established pattern already proven correct for the embedding calls earlier today (`services/embedding.py`), applied to the remaining spots that were missed at the time.

---

## Generated Questions Were Trivia About the Book, Not the Subject

**Date:** 2026-07-07

### The complaint, backed by evidence
User exported `questions` to CSV and pointed out specific rows: *"Which of the following roles did Peter Norvig hold at Google, Inc.?"*, *"which of the following statements about Stuart Russell is NOT true?"*, *"which of the following is NOT listed as a main professional society for AI?"* — all book-meta trivia (author bios, acknowledgments), not subject-matter understanding. Exact quote on what was wanted instead: *"What is the difference between AI and human intelligence?", "What separates LLMs with traditional models?"* — comparative, conceptual, college-level. Also flagged: near-duplicate questions appearing across different quiz sessions, and a mismatch between "book difficulty" (not a coherent concept — a book doesn't have a difficulty, a student does) and the app's easy/medium/hard model.

### Root cause #1 — retrieval had no diversity at all
Traced the actual numbers: for medium difficulty, `GENERATION_CONFIG["medium"]["top_k_rag"] = 5`, and `_generate_session_questions` built its candidate list via `chunks[i % len(chunks)]` for `i in range(count)`. With `count=5` and a 5-chunk pool, `selected` was **literally `chunks[0..4]` — all five retrieved chunks, in the same order, every single time** for that topic+difficulty combination. Confirmed directly from the CSV: two different sessions (`a4aaa51c...`, `2dd75f8a...`) drew from the *identical* set of chunk IDs. Out of 1,249 chunks in the book, only 5 could ever be selected, forever, regardless of how many quizzes were taken.

On top of that, those 5 chunks were consistently front-matter-heavy (pages 12–20, plus one deep chunk at 1038–1040) — because `hybrid_search`'s ranking is driven by textual/semantic relevance to the topic's bare name ("Artificial Intelligence"), and that exact phrase appears far more densely in a book's preface/introduction (which talks *about* the field) than in its technical chapters (which talk *in* the field, using specific terminology like "POMDP" or "mechanism design" rather than restating "artificial intelligence" every paragraph). Rank-ordering by relevance-to-topic-name systematically surfaces the introduction, not the substance.

### Root cause #2 — nothing told the model to reject unsuitable source material
The old prompt's core instruction — *"the question must be answerable solely from the provided chunk"* — actively rewards trivia extraction: if the chunk handed to the model happens to be an author-biography paragraph, dutifully following that instruction produces exactly the Peter Norvig/Stuart Russell questions that showed up. There was no mechanism for the model to say "this chunk isn't suitable, give me different material."

### Fix
**Retrieval (`routers/sessions.py`):** retrieve a much larger candidate pool (`max(count * 6, 30)`, not `top_k_rag`) and `random.shuffle` it before drawing from it, instead of deterministically cycling through the same top-K. Different sessions now draw from different parts of a large book. The generation loop iterates the shuffled pool until it has `count` *accepted* questions, skipping unsuitable chunks and generation failures along the way without counting them against the total (previously any failure just silently reduced the question count).

**Prompt (`services/generation.py`):**
- Rewrote `GENERATION_SYSTEM_PROMPT` to be subject-agnostic (removed a hardcoded "AI/ML course platform" framing — this app may be used for other subjects later, per the user's own example about arts) and to explicitly reward comparative/analytical questions ("what is the difference between X and Y", "why does X happen under condition Y") over fact-location trivia, with a rule to *never* ask about the author, publisher, acknowledgments, or other book-meta content.
- Added an explicit skip contract: the model returns `{"skip": true}` for front matter, biographies, tables of contents, indexes, or references lists, instead of forcing a question out of unsuitable material. `generate_question()`'s caller now checks `q.get("skip")` and moves to the next chunk in the pool rather than inserting a bad question.
- Reframed difficulty explicitly as *student level* (beginner/intermediate/advanced), not a property of the book, addressing the "I can't tell whether a book is medium or hard" complaint directly in the instructions the model sees.
- `generate_question()` now takes the actual topic name and threads it into both the system framing and the user turn, so the model knows what subject it's testing — previously the topic name was never passed at all.

### A regression caught during verification, not after
Testing the new prompt on a genuinely technical chunk (POMDPs, hard difficulty) hit `finish_reason: MAX_TOKENS` — a truncated, unparseable JSON response. The new prompt asks for longer, richer comparative questions, and combined with Gemini 2.5 Flash's invisible "thinking" token overhead (confirmed earlier today: `thoughts_token_count=14` even for a one-word reply), the old `max_output_tokens=1024` was no longer enough headroom. Raised to 2048. Caught and fixed *before* handing this back, not discovered later from a live failure.

### Verified before/after, chunk by chunk, not just "looks right"
- The exact chunk that produced the Peter Norvig/Stuart Russell trivia (`e2d2d701-...`, confirmed via direct query to contain "About the Authors" biography text) now returns `{"skip": true}` from the new prompt.
- A table-of-contents chunk (confirmed via direct content inspection — dotted-line page listings, chapter titles up to "26 Philosophical Foundations 1020") did *not* trigger skip, but still produced a legitimate, correct AI question (on the field's dual nature of understanding + building intelligence) rather than ToC trivia — the model drew on background knowledge of this well-known textbook instead of extracting fake facts from the listing itself. Not a perfect skip-trigger rate, but not a regression to trivia either.
- A genuinely technical chunk (POMDPs and multi-agent systems, page ~703) produced: *"what is the fundamental distinction between the aims of game theory and mechanism design?"* — comparative, correct, college-level, with wrong options that are plausible misconceptions rather than arbitrary unrelated facts. This is the target quality bar the user asked for, confirmed directly rather than assumed from the prompt "looking right."
- `python -c "import app.main"` clean after every change.

### Not done (flagged, not silently skipped)
- No cross-session duplicate tracking — a large random pool makes exact repeats unlikely but not impossible; explicitly avoiding chunks already used in a student's prior sessions would need a new query and was left for later.
- No ingestion-time filtering of front matter (e.g. tagging ToC/biography chunks so they're excluded from the retrieval pool entirely, rather than relying on the prompt to reject them per-call). The prompt-level skip is working well enough on the evidence above; a structural fix would mean touching ingestion and likely re-ingesting.
- Did not attempt multi-chunk synthesis (grounding one question in 2-3 chunks so comparison questions can span sections that a single ~900-token chunk might not contain both halves of) — a real potential quality improvement, but a bigger architecture change than this pass warranted.

---

## Real Question Generation Beat the Frontend's 45s Timeout — Sequential Gemini Calls

**Date:** 2026-07-08

### Symptom
A quiz session that eventually succeeded (`generated 3/3 question(s) — 1 skipped, 0 failed`, `POST /sessions/ 200 52189.7ms`) still showed the user "Question generation timed out. You can try again." This is a different case from the 2026-07-07 zero-chunks incident above — `hybrid_search` found a full pool of 30 candidates, generation genuinely succeeded, it just took longer than the frontend was willing to wait.

### Root cause
Reconstructed from the live log timeline (request IDs + timestamps), not guessed: `POST /sessions/` ([routers/sessions.py](../backend/app/routers/sessions.py)) returns fast via `BackgroundTasks`, so the frontend starts polling `GET /sessions/{id}/questions` immediately with a hardcoded 45s deadline (`GENERATION_TIMEOUT_MS` in `frontend/src/hooks/useQuizSession.ts`). But `_generate_session_questions`'s per-chunk loop `await`-ed `generate_question()` **one chunk at a time** — fully sequential. This run needed 4 sequential Gemini 2.5 Flash calls (1 skip + 3 generated) at roughly 13s/call (consistent with the "thinking" token overhead noted in the 2026-07-07 entry above), landing at ~52s total. The last poll before the deadline came back empty at ~08:49:38–39; generation actually finished 3 seconds later at 08:49:41 — a near-miss the frontend had no way to know about.

### Fix
Parallelized the per-chunk generation loop in `_generate_session_questions` (`routers/sessions.py`): chunks are now attempted in concurrent batches of 5 via `asyncio.gather` (`_GENERATION_BATCH_SIZE`) instead of one `await` at a time, with a new `_attempt_question()` helper that catches its own exceptions so one bad chunk in a batch doesn't cancel its siblings. Batch size of 5 (not "all 30 at once") is a deliberate compromise — big enough to meaningfully cut wall-clock time, small enough to stay clear of Gemini free-tier per-minute burst limits, which haven't been load-tested. `generated`/`skipped`/`failed` counters and the final summary log line are unchanged; behavior when the target `count` is reached mid-batch (extra successful generations in the same batch are discarded rather than persisted) is the only semantic difference from the old strictly-sequential early-`break`.

### Not done (flagged, not silently skipped)
- The frontend's 45s `GENERATION_TIMEOUT_MS` was left as-is — user's call was to fix the actual slowness (this entry) rather than just widen the client's patience. A pathological case (many skips in a row) can still exceed 45s even with batching; revisit the frontend timeout too if this keeps recurring.
- Did not verify actual Gemini free-tier RPM headroom for a burst of 5 concurrent calls — flagged as a risk to watch, not confirmed safe or unsafe.

### Verified live
User ran a real quiz session against the batched generation code and reached question 2 of 3 without a timeout — the session progressed normally through the UI (screenshot of question 2/3 rendering correctly). No new timeout observed. (Surfaced a separate, unrelated prompt-quality bug during this same run — see next entry.)

---

## Generated MCQ Referenced "The Examples Provided" the Student Never Sees

**Date:** 2026-07-08

### Symptom
While live-testing the batched generation fix above, user hit an MCQ that read: *"Based on the examples provided, what is a key characteristic that enables modern AI systems, such as those used for spam fighting and machine translation, to effectively handle complex and evolving challenges?"* — and asked "what examples?", confused, because none were shown anywhere on screen.

### Root cause
`QuestionCard.tsx` (`frontend/src/components/quiz/`) renders only `question_text`, the book/chapter citation, and (for MCQ) `options` — it never shows the source text chunk to the student. `GENERATION_SYSTEM_PROMPT` (`services/generation.py`) had no rule requiring the generated question to be self-contained, so when a chunk illustrated a concept with specific examples, the model wrote a question that pointed back at "the examples provided" instead of naming them inline — a reference that only resolves if the reader has the chunk in front of them, which the quiz UI never gives them. Same underlying class of problem as the 2026-07-07 "trivia about the book" entry (prompt not accounting for what the student actually sees), different manifestation.

### Fix
Added a rule to `GENERATION_SYSTEM_PROMPT`'s "WHAT MAKES A GOOD QUESTION" list: the question must stand alone since the student sees only `question_text` (+ options) and never the source chunk — explicitly bans phrases like "the examples provided," "the text states," "as discussed above," "in this passage," "the following," and requires naming any specific example directly inside `question_text` instead of pointing back at it.

### Not verified yet
Prompt change not yet exercised against a live generation call — next quiz session should confirm the model stops producing dangling references instead of just moving the phrasing around.

---

## Gemini Free-Tier Daily Quota Exhausted Mid-Session — 27 Guaranteed-Fail Calls Wasted

**Date:** 2026-07-08

### Symptom
Live session `b7eb2c67-...` logged: `generated 2/3 question(s) — 1 skipped (non-substantive), 27 failed, drawn from a pool of 30 candidate chunk(s)`. The traceback for every one of the 27 failures was the same: `google.genai.errors.ClientError: 429 RESOURCE_EXHAUSTED`.

### Root cause
The API's own error response is authoritative here, not a guess: `quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue: 20, model: gemini-2.5-flash`. Gemini's free tier allows only **20 `generate_content` calls per day** for this model on this project — and after three live-tested sessions today (this conversation's `495df733...`, the screenshot session, and `b7eb2c67...`), that cap was hit mid-generation. Once exhausted, every subsequent call in the 30-chunk pool was guaranteed to fail with the same 429 — the batched loop kept firing all of them anyway (`_QUOTA_EXHAUSTED` sentinel didn't exist yet), wasting time and log volume on calls that could never succeed. The 38s `retryDelay` in the error is irrelevant here — it doesn't shorten a daily cap.

### Fix (code, orthogonal to the quota decision below)
`_attempt_question` (`routers/sessions.py`) now catches `google.genai.errors.ClientError` specifically and checks `exc.code == 429`, returning a `_QUOTA_EXHAUSTED` sentinel instead of `None`. `_generate_session_questions`'s batch loop checks for that sentinel and `break`s out of the whole pool immediately (after finishing the current batch) instead of continuing to the next batch, logging one clear warning instead of a per-chunk traceback for every doomed call. This bounds the wasted-call blast radius to at most one batch (`_GENERATION_BATCH_SIZE` = 5) instead of the entire remaining pool.

### Not fixed — needs a decision, not code
This doesn't restore quota or make 20 requests/day enough for active development. Raised to the user as a decision point: wait for the daily reset, point generation at a Gemini model/tier with a higher free daily cap, cut `_MIN_POOL_SIZE`/`_POOL_MULTIPLIER` to conserve quota per session at the cost of retrieval diversity, or revisit the earlier plan (see the 2026-07-03 provider swap entry) to move generation back to Claude/Bedrock once budget allows. No action taken pending the user's choice.

---

## Moved Off Gemini Entirely — Direct Anthropic API for Generation, Evaluation, Chatbot

**Date:** 2026-07-08

### Why
The Gemini free-tier crunch above wasn't a one-off — Google cut free-tier daily quotas hard in December 2025 and again April 1, 2026; `gemini-2.5-flash` is down to ~20 requests/day industry-wide, not just on this project. That's unworkable for active dev/testing. User bought personal Anthropic API credits (~$10-15) specifically to move off it — reverting to Claude, but this time via a **direct personal Anthropic API key**, not the AWS Bedrock path used before the original 2026-07-03 swap (Bedrock is what put the original charge on the employer's AWS bill).

### Model split
- **Generation** (`services/generation.py`) + **goal chatbot** (`routers/goals.py`) → `claude-haiku-4-5`. Structured/simple tasks, matches the original pre-Gemini-swap role for generation (chatbot was Sonnet 4.6 originally — downgraded to Haiku deliberately for budget; no new complexity in that task justifies Sonnet pricing).
- **Evaluation** (`services/evaluation.py`) → `claude-sonnet-5` (July–Aug 2026 introductory pricing, $2/$10 per MTok). Judging conceptual-vs-expression error types and writing fair correct-vs-wrong comparisons (planned next feature, see upcoming brainstorm) is a step up in reasoning demand from simple 5-dimension scoring — chose the stronger model here specifically, not everywhere.
- Hallucination checker (`services/hallucination.py`, xAI Grok) — untouched, was never on Gemini.

### What changed, mechanically
- `config.py`: removed `GOOGLE_API_KEY`, `GEMINI_MODEL`, and the never-used-since-the-Gemini-swap `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION` fields (kept previously "to make switching back to Bedrock easy" — moot now that the switch-back target is direct API, not Bedrock). Added `ANTHROPIC_API_KEY` and three model constants (`CLAUDE_GENERATION_MODEL`, `CLAUDE_EVALUATION_MODEL`, `CLAUDE_CHATBOT_MODEL`).
- `generation.py` / `evaluation.py`: swapped `google_genai.Client` for `anthropic.AsyncAnthropic`, and — per an explicit ask to avoid wasted tokens on retries from malformed output — switched from "respond with ONLY valid JSON" + manual markdown-fence-stripping to Claude's native `output_config: {"format": {"type": "json_schema", ...}}` structured output. Guarantees schema-conformant JSON directly; the fence-stripping code is gone entirely.
- `goals.py`: client swap only. Left as free-form conversational text with the existing ` ```goal ` fence-extraction — this endpoint's output is intentionally mixed prose + optional structured tail, which doesn't fit `output_config.format` (that forces the *entire* response into schema).
- `routers/sessions.py`: the Gemini-quota-exhaustion short-circuit (`_QUOTA_EXHAUSTED` sentinel catching `google.genai.errors.ClientError` code 429) is now `_RATE_LIMITED`, catching `anthropic.RateLimitError`. Semantics shift slightly: Gemini's was a *daily* cap (guaranteed-dead for 24h, worth aborting the whole pool), Claude's is a *per-minute* rate limit (a later request might succeed) — kept the same "stop this pool" behavior anyway since immediate retries within the same request are still likely to fail.
- `main.py` `/health/ai`: replaced the Gemini generation probe with a 1-token Claude ping. Also fixed a pre-existing staleness bug found along the way — the "Google embeddings" check was pinging `app.services.embedding.embed()`, which has run on a local `BAAI/bge-base-en-v1.5` model since 2026-07-07 and never touched Google; relabeled to `local_embeddings`.
- `.env.example`: removed the stale `DATABASE_URL` line (REST-only since 2026-07-06) and the dead AWS Bedrock section along with `GOOGLE_API_KEY`; added `ANTHROPIC_API_KEY`.
- `requirements.txt`: removed `google-genai`; dropped the now-unneeded `[bedrock]` extra from `anthropic`.

### Verified
- `python -c "import app.main"` clean, plus explicit import of every touched module.
- Confirmed the installed SDK (`anthropic==0.111.0`) actually accepts `output_config` as a `messages.create()` parameter (`inspect.signature` check) before relying on it — not assumed from docs alone.

### Not yet verified
No live API call made yet (no cost incurred) — next quiz session + answer submission will be the first real test against the new provider.

---

## Backend Wouldn't Start — `Router.__init__() got an unexpected keyword argument 'on_startup'`

**Date:** 2026-07-09

### Symptom
`uvicorn` crashed on startup (before serving anything) with `TypeError: Router.__init__() got an unexpected keyword argument 'on_startup'`, raised from `fastapi/routing.py` while constructing `APIRouter()` in `routers/answers.py`. Nothing in the AIEDv2 codebase had changed since it last ran successfully.

### Root cause
This backend has never had its own virtual environment — it installs into the machine's **global per-user Python 3.11 site-packages**. `pip show starlette` showed `starlette==1.3.1` (Starlette's 1.0 line removed the `on_startup`/`on_shutdown` `Router.__init__` kwargs that the installed `fastapi==0.115.5` — an old, pre-1.0-Starlette-era version — still passes internally) with `Required-by: fastapi, mcp, sse-starlette`. Something else on this machine that also lives in that same global environment (most likely whatever installed the `mcp` package) pulled `starlette` up to 1.3.1 independently of this project, silently breaking `fastapi` here even though nothing in `requirements.txt` or the app code changed. `requirements.txt` pins `fastapi>=0.115.0` with no upper bound and never pins `starlette` at all (it's an implicit FastAPI dependency), so nothing guarded against this drift.

### Fix
Gave the backend its own isolated virtual environment (`backend/.venv/`, already covered by `backend/.gitignore`) instead of patching the version conflict in place. Ran `python -m venv .venv` then `pip install -r requirements.txt` fresh inside it — pip's resolver, working from a clean slate, picked a mutually compatible pair on its own: `fastapi-0.139.0` + `starlette-1.3.1`. This is the actual root-cause fix, not a version pin: a quick `pip install --upgrade fastapi` in the shared global environment would have unblocked this one incident, but left the underlying problem (this project's dependencies live in the same space as every other Python tool on the machine) free to recur the next time something else bumps a shared package. User chose this option explicitly over the quick global-upgrade alternative.

### Verified
- `./.venv/Scripts/python.exe -c "import app.main"` — clean, no `TypeError`.
- Re-checked (didn't just assume) that `anthropic` (resolved to `0.116.0` in the fresh install) still exposes `output_config` on `messages.create()` via `inspect.signature`, since the 2026-07-08 Anthropic migration depends on it.
- `git status --short backend/.venv` — empty, confirming the new venv is actually excluded, not silently about to be committed.

### Not done
Did not attempt to reconcile or pin exact versions for the global environment — out of scope now that this project no longer depends on it. `backend/requirements.txt` itself is unchanged (still open-ended `>=` pins); the isolation, not tighter pinning, is what prevents recurrence.

---

## "Some Answers Aren't Added" — Investigated, No Bug Found in Submission Path

**Date:** 2026-07-09

### Symptom
User reported some answers seemingly not persisting for a session, with behaviour data apparently tracked regardless.

### Investigation
Traced the full submit path (`useQuizSession.ts` → `POST /answers/` → `POST /answers/{id}/events` → `answers_decrypted`/`answer_behaviour_decrypted` INSTEAD OF INSERT triggers) and cross-referenced exported CSVs (`answers_decrypted`, `answer_behaviour_decrypted`, `questions`) row by row. Result: every existing answer has exactly one matching behaviour row and vice versa — zero orphans, zero duplicates, zero cross-session mismatches. The only "missing" rows were three *entire* sessions with 0/5, 0/2, and 0/3 answers each (not partial gaps within an otherwise-answered session) — all three session IDs (`a4aaa51c...`, `b7eb2c67...`, `495df733...`) are ones already named in the 2026-07-07 trivia/chunk-diversity entry and the 2026-07-08 Gemini-quota-exhaustion entry above. Conclusion: those sessions' generation struggled or was slow, the frontend's 45s poll timeout fired, the user moved on instead of retrying, and the backend's `BackgroundTasks`-driven generation kept running and eventually wrote `questions` rows nobody ever got to answer. No code changed — the submission pipeline itself is correct.

### Related recurrence caught live in the same conversation
A fresh live log from testing the new quiz-setup UI showed the *cause* of this class of incident directly: `hybrid_search found 0 candidate chunk(s) ... difficulty=easy` → `Zero chunks matched — likely no ingested content tagged difficulty=easy for this topic`. This is the same gap already called out as "Not fixed (by design, for now)" in the 2026-07-07 entry — Book1's chunks are all tagged `medium`, so selecting `easy`/`hard` guarantees 0 questions and an eventual timeout. Asked the user whether to build difficulty-aware validation now (disable/warn on difficulty options with no matching ingested content); declined for now — continuing to use `medium` manually until the corpus has more than one difficulty tier.

---

## Every Generation Call Failing — Claude Rejects `enum` Combined with Array `type` in Structured Output

**Date:** 2026-07-09

### Symptom
This is the "first real test against the new provider" flagged as not-yet-verified in the 2026-07-08 Anthropic migration entry above. A live log with `difficulty=medium` (so `hybrid_search` correctly found 30 candidate chunks — not the zero-chunks issue) showed **every single** `generate_question()` call failing across two separate sessions, each with the identical error:
```
anthropic.BadRequestError: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error',
'message': "output_config.format.schema: Invalid schema: Enum value 'short_answer' does not match declared type '['string', 'null']'"}}
```
Quiz generation was completely non-functional — not intermittent, not content-dependent, 100% failure rate.

### Root cause
`GENERATION_OUTPUT_SCHEMA` in `services/generation.py` declared `question_type` as `{"type": ["string", "null"], "enum": ["short_answer", "long_answer", "mcq", None]}` — an array `type` combined with `enum` on the same schema node. Every *other* nullable field in the same schema (`question_text`, `correct_index`, `expected_time_seconds`, etc.) uses the identical `type: [X, "null"]` pattern with no error, so this isn't Claude rejecting nullable-via-type-array in general — it's specifically the `enum` + array-`type` combination that its structured-output schema validator rejects, even though `'short_answer'` is trivially a string and should satisfy `['string', 'null']` under normal JSON Schema semantics. Claude's `output_config.format.json_schema` implements a stricter subset than full JSON Schema draft-07.

### Verified before fixing (not just asserted)
Wrote a minimal standalone probe script (`backend/_schema_probe.py`, deleted after use) making two tiny live calls against the real API with the same model: one with the exact current (broken) schema fragment, one with an `anyOf`-based rewrite (`"anyOf": [{"type": "string", "enum": [...]}, {"type": "null"}]`). The broken version reproduced the exact same error message character-for-character; the `anyOf` version succeeded (`{"skip": true, "question_type": null}`). Fix applied to `generation.py` only after confirming the replacement actually works, not on the theory alone. Also checked `evaluation.py`'s structured-output schema for the same anti-pattern — it has no `enum` fields at all, so it wasn't affected.

### Fix
Rewrote just the `question_type` field to use `anyOf` instead of the array-`type`+`enum` combo. No other field needed to change.

### Verified after
`python -c "import app.main"` clean. The two live probe calls above are the actual functional verification — next real quiz session will exercise it end-to-end.

---

## Next Layer of the Same Test: Claude Rejects `temperature` + `top_p` Together

**Date:** 2026-07-09

### Symptom
Immediately after the schema fix above, a fresh quiz session (`difficulty=medium`, 30 chunks found — schema error gone) still generated 0 questions. Every chunk attempt now failed identically with:
```
anthropic.BadRequestError: Error code: 400 - {'message': '`temperature` and `top_p` cannot both be specified for this model. Please use only one.'}
```

### Root cause
`generate_question()` passes both `temperature=config["temperature"]` and `top_p=config["top_p"]` to `client.messages.create()`. This particular Claude model/config combination (structured output via `output_config`) rejects specifying both sampling parameters at once.

### Verified before fixing
Grepped all Anthropic call sites: `generation.py` and `evaluation.py` both pass `temperature`+`top_p` together (same bug, `evaluation.py`'s just hadn't fired yet — nothing calls `POST /evaluations/{id}` from the frontend currently). `hallucination.py` also passes both, but it's unaffected — that one goes through `AsyncOpenAI` pointed at xAI's Grok endpoint, a different provider with no such restriction. Wrote a 3-way probe (`backend/_temp_top_p_probe.py`, deleted after use) against the live API: `temperature` alone → success, `top_p` alone → success, both together → the exact same error. Confirmed the fix works before touching real code.

### Fix
Dropped `top_p` from the `client.messages.create()` calls in both `generation.py` and `evaluation.py` — kept `temperature` only. `GENERATION_CONFIG`/`EVALUATION_CONFIG` dicts are unchanged; `top_p` is still recorded on `test_sessions.generation_top_p` / `evaluations.evaluation_top_p` for provenance, it's just no longer sent to the model itself. `hallucination.py` untouched (different provider, not broken).

### Verified after
`python -c "import app.main"` clean. Live probe confirms `temperature`-only succeeds against the real model; next real quiz session is the end-to-end check.

---

## First Live Answer Evaluation — Three Distinct Bugs Behind One 500

**Date:** 2026-07-09

### Symptom
First real end-to-end answer submission (MCQ worked, since it's rule-based). Short/long answer submissions got a `500 Internal Server Error` on `POST /evaluations/{answer_id}` every time — the actual first live exercise of `evaluate_answer()` and `check_hallucination()`, neither of which had ever been invoked before (nothing in the frontend called this endpoint until this session's quiz-card rework).

### Bug 1 — `claude-sonnet-5` rejects `temperature`/`top_p` individually, not just together
The 2026-07-09 fix above (drop `top_p`, keep `temperature`) was correct for `generation.py`'s model (`claude-haiku-4-5`, which only rejects the *combination*) but wrong for `evaluation.py`'s model. Live probe against `claude-sonnet-5` specifically:
```
neither:           SUCCESS (after one 529-overloaded retry — transient, unrelated)
temperature only:  FAILED — "`temperature` is deprecated for this model."
top_p only:        FAILED — "`top_p` is deprecated for this model."
both:               FAILED — same as temperature-only
```
Fix: dropped both params entirely from `evaluate_answer()`'s `client.messages.create()` call. `EVALUATION_CONFIG` import removed from `services/evaluation.py` (no longer used there); the router still records the configured values on the `evaluations` row for provenance.

### Bug 2 — `XAI_API_KEY` was never actually set
Once evaluate_answer() worked, `check_hallucination()` failed with `OpenAIError: Missing credentials`. Not a code bug — `backend/.env` has no `XAI_API_KEY` value, so the Grok hallucination check has never had real credentials, in this session or (seemingly) ever. Asked the user how to handle it: make the check optional rather than get a real key right now. `check_hallucination()` now returns `(False, None)` and logs a warning if `XAI_API_KEY` is unset, and the whole function body is wrapped in try/except so *any* failure in this supplementary safety check degrades gracefully instead of taking down the core evaluation feature it sits on top of.

### Feature request surfaced in the same report
User: "the evaluation model needs to explain why the other answers are wrong too" (only got "the correct answer is X" for a wrong MCQ guess). Added `explain_mcq_answer()` in `services/evaluation.py` — MCQ correctness stays a deterministic string comparison (nothing for a judge to weigh in on), but `_score_mcq` in the evaluations router now awaits a Claude call whose only job is the qualitative explanation: confirms correct/incorrect, explains why the right option is right, and names the specific misconception behind each of the other three options. `evaluator_model` on MCQ rows now records `CLAUDE_EVALUATION_MODEL` (the explanation went through it) even though correctness itself didn't.

### Verified
Live-probed all three independently before touching code: `evaluate_answer()` (confirmed the exact 500, then confirmed the fix), `check_hallucination()` (confirmed the exact missing-credentials error, then confirmed graceful skip), `explain_mcq_answer()` (confirmed it actually names all three wrong options' specific errors, not generic "it's wrong" filler). `python -c "import app.main"` clean throughout.

### Separately: hooks-order crash reported alongside this
Console also showed a React "change in the order of Hooks" crash in `GenerationPage`/`useQuizSession`. Read `useQuizSession.ts` fully — every hook is called unconditionally in a fixed sequence, no conditionals or early returns before any hook. Same signature as the earlier `ReferenceError: useRef is not defined` incident this session: a stale Vite Fast Refresh snapshot mid-edit, not a real bug. No code change; resolves with a hard refresh.

---
