
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
