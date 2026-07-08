# AIEDv2 — Component & Dependency Registry
**Last Updated:** July 2026

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
| ~~Claude Haiku 4.5~~ / **Gemini 2.5 Flash** | Question generation | ✅ | Replaced 2026-07-03 — generation was running on employer-billed AWS Bedrock credentials for a personal project. See `TECHNICAL_LOG.md` "AI Provider Swap". Plan is to switch back once self-funded. |
| ~~Claude Sonnet 4.6~~ / **Gemini 2.5 Flash** | Answer evaluation + hallucination verification + goal chatbot | ✅ | Same swap, same reason, 2026-07-03. |
| ~~`gemini-embedding-001`~~ | ~~Text embeddings (RAG)~~ | ❌ Replaced | Wired in 2026-07-07 to replace the fully-retired `text-embedding-004`, then replaced again same day after repeatedly hitting its free-tier 1000/day quota mid-ingestion. See `TECHNICAL_LOG.md` "Embeddings Moved Off Gemini Entirely". |
| `BAAI/bge-base-en-v1.5` (local, via `sentence-transformers`) | Text embeddings (RAG) | ✅ | Native 768-dim (exact schema match), asymmetric retrieval design (matches existing `task_type` split), no rate limits — runs locally. Chosen over `BGE-M3` (the more commonly recommended 2026 default) because BGE-M3 outputs 1024 dims and targets multilingual coverage this English-only corpus doesn't need. ~8ms/chunk on this machine's GPU vs ~1-1.2s/chunk over Gemini's API. |
| Qwen3 32B via Groq (`qwen/qwen3-32b`) | Emergency evaluation fallback | ✅ | 67.5% BullshitBench v2 — second highest of all providers tested. Separate infrastructure from Anthropic (genuine redundancy). Never called in normal operation. |
| ~~Grok 4.3~~ | ~~Hallucination checker~~ | ❌ Removed | BullshitBench v2: 50% pushback. Using a 50% pushback model to verify a 91% pushback model is architecturally unsound. Removed entirely. |

**Note:** the BullshitBench comparison numbers above were the basis for choosing Claude originally — kept as historical record even though generation/evaluation now run on Gemini for cost reasons, not a reassessment of quality. `xAI Grok` (hallucination checker in earlier design) and `openai`-compatible Groq client are separate from the Gemini swap and untouched.

---

## Backend — Python

| Package | Pinned (`>=`) | Latest | Status | Why |
|---|---|---|---|---|
| `fastapi` | `>=0.115.0` | `0.136.3` | ⚠️ | Core web framework. Async-native, automatic OpenAPI docs. |
| `uvicorn[standard]` | `>=0.34.0` | `0.49.0` | ⚠️ | ASGI server for FastAPI. `[standard]` includes uvloop + httptools for performance. |
| `pydantic` | `>=2.10.0` | `2.13.4` | ⚠️ | v2 — request/response validation. Used for all API models. |
| `pydantic-settings` | `>=2.8.0` | latest | ✅ | Loads config from `.env` into typed `Settings` class. |
| ~~`asyncpg`~~ | — | — | ❌ Removed | Removed 2026-07-06 — the encrypted-column write path only ever needed *some* SQL running inside Postgres (the vault key isn't REST-reachable), not a persistent app-side connection. Replaced by `INSTEAD OF INSERT/UPDATE` triggers + RPC functions, called via `supabase_rest.py`. See `TECHNICAL_LOG.md` "Removed asyncpg/DATABASE_URL Entirely". |
| `supabase` | `>=2.15.0` | `2.29.0` | ⚠️ | Used exclusively for Storage (signed URLs, upload/download). All table/view/RPC access goes through the hand-rolled REST client (`app/supabase_rest.py`), not this package. |
| ~~`anthropic`~~ | — | — | ❌ Unused | Generation/evaluation/goal-chat moved to Gemini 2.5 Flash 2026-07-03 (cost, not capability — see AI Models section). Left in `requirements.txt` for an easy revert; not imported anywhere in the running code. |
| `openai` | `>=1.73.0` | `2.41.0` | 🔴 | OpenAI-compatible client used for Groq API (emergency fallback). Major version gap — API breaking changes likely. Update before building evaluation fallback. |
| ~~`google-generativeai`~~ | — | — | ❌ Removed | Deprecated January 14, 2026, all support ended. Fully replaced by `google-genai` — no remaining imports. |
| `google-genai` | `>=1.24.0` | latest | ✅ | Used for Gemini generation calls only: generation (`generation.py`), evaluation (`evaluation.py`), goal chat (`goals.py`). No longer used for embeddings as of 2026-07-07 — see `sentence-transformers` below and `TECHNICAL_LOG.md`. |
| `sentence-transformers` | `>=3.0.0` | latest | ✅ | Local embeddings (`services/embedding.py`) via `BAAI/bge-base-en-v1.5` — replaced `google-genai`'s embedding calls after repeatedly hitting the free tier's 1000/day quota. Pulls in `torch` (already present, CUDA 12.1 build — auto-uses the GPU if present). |
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
| 🔴 HIGH | `openai` (backend) | Update from `>=1.73.0` to `>=2.0.0`. Review breaking changes before building the Groq fallback path. |
| ⚠️ MED | `fastapi`, `uvicorn`, `supabase`, `tiktoken` | All behind latest. Update `requirements.txt` pins before production deploy. |
| ⚠️ MED | `vite`, `lucide-react` | Behind latest. No breaking changes expected — update before production. |
| ✅ DONE | `google-generativeai` → `google-genai` | Completed — see AI Models section. |
| ✅ DONE | `asyncpg` removal | Completed 2026-07-06 — see AI Models/Infrastructure notes and `TECHNICAL_LOG.md`. |
