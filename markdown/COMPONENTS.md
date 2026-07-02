# AIEDv2 — Component & Dependency Registry
**Last Updated:** June 2026

---

## Legend
| Symbol | Meaning |
|---|---|
| ✅ | Current, no action needed |
| ⚠️ | Behind latest — update when convenient |
| 🔴 | Deprecated or breaking — must update |

---

## Infrastructure & Services

| Component | Version in use | Latest | Status | Why chosen |
|---|---|---|---|---|
| Supabase (PostgreSQL) | Managed | — | ✅ | PostgreSQL + pgvector + Storage + Auth + Vault in one platform. Eliminates separate vector DB. |
| pgvector | Managed (Supabase) | — | ✅ | Native PostgreSQL vector similarity search. 768-dim embeddings, IVFFlat cosine index. |
| Hetzner CPX21 (Singapore) | — | — | ✅ | 3 vCPU / 4 GB RAM. Only VPS option with enough RAM for PyMuPDF + chunking pipeline (~1–2 GB peak). $25.38/mo Singapore. |
| Cloudflare Tunnel | Free plan | — | ✅ | No open ports on VPS, SSL automatic, real IP never exposed. **Known bug:** GET-based SSE is buffered (GitHub #1449, unresolved). All streaming endpoints must use POST or WebSocket. |
| GitHub Actions | Free tier | — | ✅ | SSH deploy to Hetzner on push to `main`. ~30 min/month usage vs 2,000 min/month free. |
| Supabase Vault | Managed | — | ✅ | Stores the `student_pii` encryption key. Key never appears in application code or `.env`. Backed by pgsodium internally. |
| pgcrypto | PostgreSQL extension | — | ✅ | Column-level encryption via `pgp_sym_encrypt` / `pgp_sym_decrypt`. Chosen over pgsodium direct after Supabase managed environment blocked `pgsodium_keyiduser` role grants. |

---

## AI Models

| Model | Role | Status | Why chosen |
|---|---|---|---|
| Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | Question generation | ✅ | Handles multi-task structured prompts reliably. Same Anthropic API as Sonnet — one key, one billing. $1.00/$5.00 per MTok. |
| Claude Sonnet 4.6 (`claude-sonnet-4-6`) | Answer evaluation + hallucination verification + goal chatbot | ✅ | 91% BullshitBench v2 clear pushback — highest of all models tested. 1M context window. Required for multi-dimensional scoring rubric. |
| `gemini-embedding-001` | Text embeddings (RAG) | ✅ | Top MTEB multilingual leaderboard. MRL dimension flexibility — set to 768 via `output_dimensionality=768` (default is 3072). Free tier available. |
| Qwen3 32B via Groq (`qwen/qwen3-32b`) | Emergency evaluation fallback | ✅ | 67.5% BullshitBench v2 — second highest of all providers tested. Separate infrastructure from Anthropic (genuine redundancy). Never called in normal operation. |
| ~~Grok 4.3~~ | ~~Hallucination checker~~ | ❌ Removed | BullshitBench v2: 50% pushback. Using a 50% pushback model to verify a 91% pushback model is architecturally unsound. Removed entirely. |

---

## Backend — Python

| Package | Pinned (`>=`) | Latest | Status | Why |
|---|---|---|---|---|
| `fastapi` | `>=0.115.0` | `0.136.3` | ⚠️ | Core web framework. Async-native, automatic OpenAPI docs. |
| `uvicorn[standard]` | `>=0.34.0` | `0.49.0` | ⚠️ | ASGI server for FastAPI. `[standard]` includes uvloop + httptools for performance. |
| `pydantic` | `>=2.10.0` | `2.13.4` | ⚠️ | v2 — request/response validation. Used for all API models. |
| `pydantic-settings` | `>=2.8.0` | latest | ✅ | Loads config from `.env` into typed `Settings` class. |
| `asyncpg` | `>=0.30.0` | `0.31.0` | ✅ | Direct async PostgreSQL driver. Used for all DB queries (raw SQL, no ORM). `supabase-py` used only for Storage signed URLs. |
| `supabase` | `>=2.15.0` | `2.29.0` | ⚠️ | Used exclusively for Supabase Storage signed URL generation. All DB access goes through asyncpg. |
| `anthropic` | `>=0.51.0` | `0.104.1` | ⚠️ | Anthropic Python SDK. Haiku (generation) + Sonnet (evaluation, verification, goal chat). Prompt caching enabled on all system prompts. |
| `openai` | `>=1.73.0` | `2.41.0` | 🔴 | OpenAI-compatible client used for Groq API (emergency fallback). Major version gap — API breaking changes likely. Update before building evaluation fallback. |
| ~~`google-generativeai`~~ | ~~`>=0.8.0`~~ | — | 🔴 **DEPRECATED** | Deprecated January 14, 2026. All support ended. Must be replaced with `google-genai`. |
| `google-genai` | not yet added | latest | 🔴 **ACTION REQUIRED** | Replacement for `google-generativeai`. Ingestion service must be updated before embeddings are built. |
| `python-jose[cryptography]` | `>=3.3.0` | `3.5.0` | ✅ | JWT encode/decode for local session tokens. `[cryptography]` backend required. |
| `msal` | `>=1.32.0` | `1.37.0` | ✅ | Microsoft Authentication Library for Entra ID OAuth2 callback. |
| `httpx` | `>=0.28.0` | latest | ✅ | Async HTTP client. Used in auth router to call Supabase Auth API and Supabase REST API. |
| `bcrypt` | `>=4.3.0` | latest | ✅ | Password hashing (12+ rounds). |
| `python-multipart` | `>=0.0.20` | latest | ✅ | Required by FastAPI for `OAuth2PasswordRequestForm` (form body parsing). |
| `pdfplumber` | `>=0.11.0` | `0.11.9` | ✅ | PDF text extraction for ingestion pipeline. |
| `tiktoken` | `>=0.9.0` | `0.13.0` | ⚠️ | Token counting for chunk size enforcement (800–1000 tokens per chunk). |
| `psycopg2-binary` | `>=2.9.10` | latest | ✅ | Sync PostgreSQL driver. Included as fallback dependency — primary driver is asyncpg. |
| `python-dotenv` | `>=1.1.0` | latest | ✅ | `.env` file loading (also handled by pydantic-settings, redundant but harmless). |

---

## Frontend — JavaScript / TypeScript

| Package | Pinned (`^`) | Latest | Status | Why |
|---|---|---|---|---|
| `react` | `^19.0.0` | `19.2.7` | ✅ | UI framework. |
| `react-dom` | `^19.0.0` | `19.2.7` | ✅ | React DOM renderer. |
| `react-router-dom` | `^7.15.0` | `7.17.0` | ✅ | Client-side routing. Routes: `/`, `/login`, `/signup`, `/callback`, `/dashboard`. |
| `vite` | `^6.2.0` | `8.0.16` | ⚠️ | Build tool and dev server. |
| `@vitejs/plugin-react` | `^5.0.4` | latest | ✅ | Vite plugin for React Fast Refresh. |
| `motion` | `^12.23.24` | `12.40.0` | ✅ | Animation library (successor to framer-motion). Used for landing page scroll-linked animations, cursor, transitions. |
| `lucide-react` | `^0.546.0` | `1.17.0` | ⚠️ | Icon set. Used in landing page and nav. |
| `tailwindcss` | `^4.1.14` | `4.2.0` | ✅ | Utility CSS. Used on landing page. Post-login pages use inline styles intentionally (minimal, functional). |
| `@tailwindcss/vite` | `^4.1.14` | latest | ✅ | Vite integration for Tailwind v4. |
| `typescript` | `~5.8.2` | `6.0.3` (RC) | ✅ | Static typing. Pinned to `~5.8` intentionally — TS 6 is not yet stable for production. |
| `@google/genai` | `^1.29.0` | latest | ✅ | Google GenAI client (frontend, if needed). Note: backend uses the Python equivalent `google-genai`. |
| `express` | `^4.21.2` | latest | ✅ | Included as dev dependency — not used in production frontend. |

---

## Actions Required

| Priority | Package | Action |
|---|---|---|
| 🔴 HIGH | `google-generativeai` (backend) | Remove from `requirements.txt`. Replace with `google-genai`. Update `app/services/ingestion.py` import before building ingestion feature. |
| 🔴 HIGH | `openai` (backend) | Update from `>=1.73.0` to `>=2.0.0`. Review breaking changes before building the Groq fallback path. |
| ⚠️ MED | `fastapi`, `uvicorn`, `anthropic`, `asyncpg`, `supabase`, `tiktoken` | All behind latest. Update `requirements.txt` pins before production deploy. |
| ⚠️ MED | `vite`, `lucide-react` | Behind latest. No breaking changes expected — update before production. |
