# Cost Structure — AI Education Platform
**Version:** 4.0  
**Last Updated:** May 2026  
**Status:** Approved for development

---

**⚠️ Flagged, not corrected, as of 2026-07-16:** the code now runs `claude-sonnet-5` and `claude-haiku-4-5` (`backend/app/config.py`), not the "Claude Sonnet 4.6" / "Claude Haiku 4.5" this document's pricing tables were built around — those are different model generations with pricing this document has not re-verified. Every `$/MTok` figure, rate limit, and cost projection below should be treated as **unconfirmed for the models actually in use** until re-checked against real current pricing before any real budget commitment. Not rewritten here because the actual current numbers aren't in hand — guessing at them would be worse than leaving this flagged. Also not reflected below: the new evaluation-analysis chatbot (`/evaluation` page, 2026-07-16) adds a second user-triggered, pay-per-message cost path on top of the existing goal chat — both reuse the same `CLAUDE_CHATBOT_MODEL` row above, so no new model to price, but a second usage pattern this doc's "Cost Per Question Cycle" section doesn't account for (that section only covers the automatic quiz generation → evaluation → verification path, not on-demand chat).

---

## Exchange Rate Reference
| Currency | Rate |
|---|---|
| 1 USD | ~314 LKR |

---

## AI Model Pricing (Per Million Tokens)

### Claude Models (Anthropic)

| Model | Role in system | Input | Cached Input | Output |
|---|---|---|---|---|
| Claude Haiku 4.5 | Question generation | $1.00 / MTok | $0.10 / MTok | $5.00 / MTok |
| Claude Sonnet 4.6 | Evaluation + goal chat | $3.00 / MTok | $0.30 / MTok | $15.00 / MTok |

**Prompt caching rules (Anthropic):**
- 5-minute cache write: 1.25x base input price
- 1-hour cache write: 2x base input price
- Cache read (hit): 0.10x base input price — 90% cheaper than standard input

### Qwen3.5 397b via Groq API (emergency fallback only)

| Model | Role in system | Input | Output |
|---|---|---|---|
| Qwen3.5 397b | Emergency evaluation fallback — Anthropic outage only | Groq pricing | Groq pricing |

Never called in normal operation. Flagged in `evaluations.fallback_model_used` when used. Cost impact: negligible — outage scenarios only.

**Grok 4.3 — Removed**  
Initially proposed as hallucination checker. BullshitBench v2: 50% clear pushback — accepts fabricated content 50% of the time. Using a 50% pushback model to verify a 91% pushback model is architecturally unsound. Removed entirely.

### Google Gemini Embeddings

| Model | Use case | Free tier | Paid tier |
|---|---|---|---|
| `gemini-embedding-001` | Text embeddings for RAG | Free (data used for training) | $0.15 / MTok |
| `gemini-embedding-2` | Multimodal (not needed) | Free (data used for training) | $0.20 / MTok |

**Chosen model:** `gemini-embedding-001` — text-only, exactly fits the use case, cheapest option.

**Important:** Free tier allows Google to use your data to improve their products. Switch to paid tier before going live with real users to protect student data privacy.

---

## Model Selection Justification

### Claude Sonnet 4.6 — Evaluation Engine

BullshitBench v2 benchmark — clear pushback on fabricated content:

| Model | Pushback score | Decision |
|---|---|---|
| Claude Sonnet 4.6 | 91% | **Selected** |
| Qwen3.5 397b | 67.5% | Emergency fallback |
| Claude Opus 4.6 | 83% | Eliminated — lower pushback than Sonnet, significantly higher cost |
| Grok 4.3 | 50% | Removed — see below |
| Google best | 37.5% | Rejected |
| GPT-4o Mini | 20% | Rejected |

Evaluation requires multi-dimensional reasoning across five scoring dimensions simultaneously while cross-referencing answer against source chunk and expected concepts. Highest reasoning depth and truth-adherence required. Sonnet 4.6 is the only model that passes every requirement. Opus 4.6 costs more and scores lower on pushback — eliminated on both counts.

### Grok 4.3 — Removed

Initially proposed as hallucination checker. BullshitBench v2 shows 50% clear pushback — accepts fabricated content half the time. Using a 50% pushback model to verify a 91% pushback model is architecturally unsound. Removed from the stack entirely. No further argument needed.

### Qwen3.5 397b via Groq — Emergency Fallback

67.5% clear pushback — second highest of all providers tested, well above Google (37.5%) and OpenAI (37.5%). GPT-4o Mini at 20% clear pushback was rejected outright. Qwen is open source on separate infrastructure from Anthropic — genuine redundancy. Never called in normal operation. Cost impact is negligible.

---

### Claude Haiku 4.5 — Question Generation

Question generation is a multi-task prompt in a single call: read a textbook chunk, generate a question, classify difficulty, extract expected concepts as structured JSON, and write a citation. This is not a simple single-task operation — it requires simultaneous multi-step reasoning and reliable structured output every time.

**vs Free models (Qwen, Llama, Mistral)**  
Produce acceptable output ~80% of the time but break down on complex stacked prompts — rigid questions, malformed JSON, inconsistent difficulty calibration. For a student-facing product where every question matters, a 20% failure rate is not acceptable in production.

**vs GPT-4o Nano**  
Designed for simple single-task operations. Produces the rigid, low-quality output that causes student disengagement. Wrong tool for this job regardless of price.

**vs GPT-4o Mini**  
Closest real competitor and capable of handling the task, but requires significantly heavier system prompting and stricter guardrails to match Haiku's consistency. In practice this means ongoing prompt maintenance, higher engineering overhead, and higher output variance at scale. The cost difference at this usage volume is approximately $3–4/month — not a meaningful saving against the reliability risk. It also introduces a second API relationship (OpenAI alongside Anthropic) — two billing accounts, two sets of rate limits, two dashboards to manage.

**Why Haiku 4.5**  
Handles complex multi-task prompts cleanly with minimal guardrailing, produces consistent structured JSON output reliably, and sits on the same Anthropic API as Sonnet — one key, one dashboard, one billing relationship. At $1.00/$5.00 per MTok the absolute cost per question generated is fractions of a cent, making it the most cost-effective reliable option for production.

### 4. Grok output is very cheap — no longer applies

Grok 4.3 has been removed from the stack. See Model Selection Justification above.

---

## Infrastructure Pricing

| Service | Purpose | Cost |
|---|---|---|
| Hetzner CPX21 Singapore | Backend + frontend — 3 vCPU, 4GB RAM, two Docker containers | ~$16/month |
| Cloudflare Tunnel + DNS + SSL | Public URLs for both containers, no ports exposed, SSL automatic | Free |
| GitHub Actions | Auto-deploy on push to main via SSH | Free (2,000 min/month) |
| Supabase | PostgreSQL + pgvector + Auth + Storage | Free → $25/month (Pro at ~50 users) |
| Domain via Cloudflare Registrar | yourapp.com | ~$1/month |
| **Total (infrastructure only)** | | **~$17/month + Supabase when needed** |

**Deployment model:** FastAPI backend and React frontend run as separate Docker containers on one Hetzner VPS. Backend exposed at `api.yourdomain.com`, frontend at `app.yourdomain.com`, both via Cloudflare Tunnel. Frontend is a multi-stage Docker build — Node builds React, Nginx serves the static output. No external hosting platform needed.

**Why not Railway:** 512MB RAM limit crashes during PDF ingestion. PyMuPDF + LangChain chunking on a 400-page textbook peaks at 1–2GB RAM. Discarded.

**Why not Vercel:** Initially considered for React frontend on the free tier. Discarded — both containers live on the same Hetzner VPS, keeping the stack self-contained. Nginx inside the frontend Docker container replaces Vercel entirely at no extra cost.

**Why not AWS EC2:** ap-southeast-1 Singapore t4g.small starts at ~$20/month for only 2GB RAM, plus separate EBS costs. More expensive than Hetzner for inferior specs. Discarded on both cost and complexity grounds.

---

## Storage Cost Analysis

### Supabase Storage — Raw PDFs

| Scenario | Size | Supabase Pro included | Overage |
|---|---|---|---|
| 10 books | ~200MB | 100GB included | None |
| 50 books | ~1GB | 100GB included | None |
| 100 books | ~2GB | 100GB included | None |
| 5,000 books | ~100GB | Hits ceiling | $0.021/GB after |

Raw PDF storage is not a cost concern at any realistic university library scale.

### pgvector DB — Embeddings + Chunk Text

| Metric | Calculation | Result |
|---|---|---|
| Embedding size | 768 float32 × 4 bytes | 3,072 bytes ≈ 3KB per chunk |
| Chunk text | ~500 bytes per chunk | ~0.5KB per chunk |
| Total per chunk | 3KB + 0.5KB | ~3.5KB |
| Chunks per book | ~800 (400-page book) | — |
| DB cost per book | 800 × 3.5KB | ~2.8MB |
| 10 books | 10 × 2.8MB | ~28MB |
| 100 books | 100 × 2.8MB | ~280MB |
| Supabase Pro DB | 8GB included | $0.125/GB after |

100 books = ~280MB = 3.5% of the 8GB included tier. Not a cost concern for a long time.

### The Actual Risk — Content Duplication

Storage cost is not the problem. Library quality and RAG reliability are. If 50 students upload slightly different editions of the same textbook:

- 50 duplicate documents in Supabase Storage
- 50 × 800 = 40,000 duplicate chunks in pgvector
- RAG retrieval returns redundant results
- Recommendations point to duplicate sections

**Solution:** Duplicate detection before ingestion — zero extra infrastructure cost.

### Duplicate Detection — Cost Impact

| Step | Cost |
|---|---|
| Extract first 3 pages text | Free (PyMuPDF, runs on Hetzner) |
| Embed sample (Google text-embedding-004) | ~$0.000045 per check (3 pages ≈ 300 tokens) |
| pgvector similarity query | Free — existing DB query |

Cost per duplicate check: fractions of a cent. For 100 book uploads per year: under $0.01 total. Negligible.

### Student Upload TTL — Storage Impact

Student personal uploads are temporary (7-day TTL, hard deleted by nightly Supabase Edge Function). At any point the active personal upload pool is bounded by: (daily student uploads × 7). At 200 active students uploading 1 document/week each: ~200 documents × 20MB = ~4GB peak personal storage. Negligible against the 100GB included tier.

### What Was Added / Removed (v2.0)

| Change | Detail |
|---|---|
| **Added** | Storage cost analysis — Supabase Storage and pgvector DB math |
| **Added** | Duplicate detection cost breakdown — ~$0.000045 per check |
| **Added** | Student upload TTL storage impact analysis |
| **Removed** | Grok 4.3 — BullshitBench v2 disqualified (50% pushback) |
| **Not adopted** | n8n — not needed for duplicate detection; standard FastAPI endpoint |
| **Replaced** | Railway → Hetzner CPX21 Singapore ($16/month fixed, 4GB RAM) |
| **Replaced** | Grok hallucination check → Sonnet 4.6 Option C verification |

### What Was Added / Removed (v3.0)

| Change | Detail |
|---|---|
| **Added** | Deployment Architecture section — full VPS, Docker Compose, Cloudflare Tunnel, CI/CD, alternative comparison |
| **Removed** | Vercel — frontend now served by Nginx inside Docker container on Hetzner, no external platform needed |
| **Rejected** | AWS EC2 — more expensive ($20+/month), only 2GB RAM, higher configuration complexity |
| **Updated** | Large tier total: $462 → $442 (Vercel Pro $20/month no longer applies at any tier) |
| **Updated** | Infrastructure cap confirmed at $42/month for medium and large tiers — no further jumps |

---

## Cost Per Question Cycle (Real Numbers)

Every time a student answers one question, three AI calls are made:

### Question generation (Claude Haiku 4.5)
```
System prompt (cached):  ~300 tokens × $0.10/MTok  = $0.00003
RAG chunks + question:   ~500 tokens × $1.00/MTok  = $0.0005
Output (question text):  ~200 tokens × $5.00/MTok  = $0.001
Total per question generated: ~$0.0015
```

### Evaluation (Claude Sonnet 4.6, with prompt caching)
```
System prompt (cached):  ~600 tokens × $0.30/MTok  = $0.00018
Unique input (answer + context + concepts): ~500 tokens × $3.00/MTok = $0.0015
Output (scores + feedback): ~400 tokens × $15.00/MTok = $0.006
Total per evaluation: ~$0.0077
```

### Hallucination verification (Sonnet 4.6, Option C — sampling + trigger-based)
```
Runs on ~15–20% of evaluations (15% random + threshold triggers)

Per verification call (when triggered):
System prompt (cached):  ~600 tokens × $0.30/MTok  = $0.00018
Unique input (eval + source chunk): ~800 tokens × $3.00/MTok = $0.0024
Output (findings): ~200 tokens × $15.00/MTok = $0.003
Total per verification call: ~$0.0056

Average cost per question (at ~20% trigger rate):
$0.0056 × 0.20 = ~$0.001
```

### Total per question answered
```
Generation:                  ~$0.0015
Evaluation:                  ~$0.0077
Verification (amortised):    ~$0.0010
─────────────────────────────────────
Total per question:          ~$0.010  (approximately 1 cent)
Total per session (10 questions): ~$0.10
```

Total is unchanged from previous design — Grok cost ($0.0004) is replaced by amortised Sonnet verification cost (~$0.001), offset by Grok's removal.

---

## Monthly Cost Estimates by User Tier

Assumes each active student completes 2 sessions per week (80 sessions/month per 10 users).

| Tier | Active users | Sessions/month | AI costs | Infrastructure | Total/month | Total LKR/month |
|---|---|---|---|---|---|---|
| Small | 50 | ~400 | ~$40 | ~$17 | ~$57 | ~LKR 17,900 |
| Medium | 200 | ~1,600 | ~$160 | ~$42 | ~$202 | ~LKR 63,400 |
| Large | 500 | ~4,000 | ~$400 | ~$42 | ~$442 | ~LKR 138,800 |

**Infrastructure breakdown:** Hetzner $16 (fixed, all tiers) + Cloudflare $0 + GitHub Actions $0 + Supabase $0→$25 (kicks in at ~50 users) + Domain ~$1. No Vercel at any tier — frontend runs on Hetzner via Nginx Docker container.  
**Note:** Infrastructure cost is capped at $42/month once Supabase Pro kicks in. No further jumps at higher user counts — Hetzner is a fixed rate regardless of traffic.

---

## Cost Optimisation Strategies

### 1. Prompt caching (implement from day one)
Cache all system prompts — evaluation rubric, question generation instructions, hallucination checker instructions. These are identical on every call. Caching reduces input costs by 90% on cached portions.

```python
# Add this to every system prompt in your API calls
"cache_control": {"type": "ephemeral"}
```

### 2. Batch API for non-real-time tasks
Sonnet and Haiku both support batch processing at 50% discount. Use batch for:
- Study plan generation (not time-sensitive)
- Recommendation engine (runs after session completes)
- Weekly progress report generation

Do NOT use batch for evaluation (students wait for results) or question generation (student is actively waiting).

### 3. Embedding cost is negligible
4-5 AIML textbooks at ~800 chunks each = ~4,000 chunks. At $0.15/MTok that is literally cents for the entire ingestion. Embeddings only run once per document — not per student request.

### 4. Verification is amortised, not per-call
Sonnet's verification pass runs on ~15–20% of evaluations. At moderate usage this adds ~$0.30/month — negligible, and cheaper than running Grok on every call.

### 5. Switch Gemini embeddings to paid before launch
Free tier allows Google to use student data for training. Switch to $0.15/MTok paid tier before any real users join. At your embedding volume this costs under $1/month total.

---

## Presenting to the Organisation

### What to say
> "Monthly cost scales with active users. For up to 50 students the platform runs at approximately $57/month. For 50–200 students approximately $202/month. For 200–500 students approximately $442/month. Backend and frontend are both hosted on a single dedicated Hetzner VPS in Singapore at $16/month fixed — no surprise scaling bills. Infrastructure cost is capped at $42/month total across all user tiers once Supabase Pro activates. The primary cost driver is the AI evaluation engine which processes every student answer individually to provide personalised bias-neutral feedback and scoring."

### What to ask for
- Minimum 3 months budget upfront — AI API billing can spike during exam season
- Buffer of 20% above estimates for unexpected usage spikes
- Confirm user size target before committing to a tier

### Suggested ask by tier
| Target users | Monthly ask | 3-month buffer ask |
|---|---|---|
| Up to 50 | $57/month | $205 |
| Up to 200 | $202/month | $725 |
| Up to 500 | $442/month | $1,590 |

---

## Post-Development Security Scan

Before going live with real users, run a full vulnerability scan using **HostedScan** (hostedscan.com). This tool runs OWASP ZAP, Nikto, and other scanners against your live Hetzner (via Cloudflare Tunnel) URLs.

**When to run it:** After full deployment to Hetzner + Cloudflare Tunnel, before opening to any real users.

**What it will check for your stack specifically:**
- Exposed FastAPI endpoints without proper auth
- Misconfigured CORS headers
- Missing security headers (HSTS, CSP, X-Frame-Options)
- Supabase Storage misconfiguration
- SSE endpoint vulnerabilities
- SQL injection vectors in API parameters
- JWT handling issues

**Process:**
1. Deploy fully to Railway + Vercel
2. Run HostedScan against both URLs
3. Fix all critical and high severity findings
4. Re-run scan to confirm fixes
5. Sign off and open to users

HostedScan has a free tier for basic scans. Paid tier recommended for a full pre-launch audit — one-time cost, worth it for a production system handling student data.

---

## Service Rate Limits, Capabilities & Constraints

### Critical Findings (v4.0)

Research surfaced four factual errors and one architectural risk that require immediate correction:

| Severity | Issue | Correction |
|---|---|---|
| **CRITICAL** | `text-embedding-004` deprecated January 14, 2026 | Replace with `gemini-embedding-001` throughout |
| **CRITICAL** | `Qwen3.5 397B` does not exist on Groq | Available models: `qwen/qwen3-32b` or `qwen-qwq-32b` |
| **HIGH** | Hetzner CPX21 **Singapore** is ~$25.38 USD/month, not $16 | $16 is the EU price (€9.49/mo). Singapore is ~2.4× more expensive |
| **HIGH** | Cloudflare Tunnel buffers GET-based SSE — events are not streamed in real-time | Affects any FastAPI SSE endpoint. Use POST-based streaming or WebSocket instead |
| **MEDIUM** | Groq Qwen models are **Preview** status | Can be deprecated without notice — not Production SLA |

---

### 1. Anthropic API — Claude Haiku 4.5 & Sonnet 4.6

#### Rate Limits by Tier

| Tier | Requirement | Monthly cap | Haiku 4.5 RPM | Haiku 4.5 ITPM | Sonnet 4.6 RPM | Sonnet 4.6 ITPM |
|---|---|---|---|---|---|---|
| Tier 1 | $5 cumulative spend | $100 | 50 | 50,000 | 50 | 30,000 |
| Tier 2 | $40 cumulative spend | $500 | 1,000 | 450,000 | 1,000 | 450,000 |
| Tier 3 | $200 cumulative spend | $1,000 | 2,000 | 1,000,000 | 2,000 | 800,000 |
| Tier 4 | $400 cumulative spend | $200,000 | 4,000 | 4,000,000 | 4,000 | 2,000,000 |

**Note:** Cache read tokens (`cache_read_input_tokens`) do **not** count toward ITPM — only uncached input and cache write tokens consume the quota. Heavy caching dramatically increases effective throughput. No separate TPD limit is published — only per-minute and monthly spend caps.

**Note:** Sonnet 4.x ITPM/OTPM is a **shared pool** across Sonnet 4.6, Sonnet 4.5, and Sonnet 4. Running multiple Sonnet versions draws from the same bucket.

#### Context Window & Output Limits

| | Haiku 4.5 | Sonnet 4.6 |
|---|---|---|
| Context window | 200,000 tokens | **1,000,000 tokens** |
| Max output (sync) | 64,000 tokens | 64,000 tokens |
| Max output (Batch API) | 64,000 tokens | **300,000 tokens** (with beta header) |
| Knowledge cutoff | Feb 2025 (reliable) | Aug 2025 (reliable) |
| Adaptive thinking | No | Yes |

#### Prompt Caching — Precise Numbers

| Cache operation | Price multiplier | Haiku 4.5 effective | Sonnet 4.6 effective |
|---|---|---|---|
| 5-min cache write | 1.25× base input | $1.25/MTok | $3.75/MTok |
| 1-hour cache write | 2.0× base input | $2.00/MTok | $6.00/MTok |
| Cache read (hit) | 0.10× base input | **$0.10/MTok** | **$0.30/MTok** |
| Min tokens to cache | — | **4,096 tokens** | **2,048 tokens** |

Break-even: 5-min cache pays off after **1 read**. 1-hour cache pays off after **2 reads**.

#### Batch API

| Detail | Value |
|---|---|
| Discount | 50% off standard prices |
| Haiku 4.5 batch | $0.50 input / $2.50 output per MTok |
| Sonnet 4.6 batch | $1.50 input / $7.50 output per MTok |
| Max per batch | 100,000 requests or 256 MB |
| Typical completion | Under 1 hour |
| Hard expiry | 24 hours |
| Use 1-hour cache TTL in batches | Batches exceed the 5-min TTL — use `"ttl": "1h"` |

#### Haiku 4.5 — Advantages & Disadvantages

| Advantages | Disadvantages |
|---|---|
| Highest ITPM at Tier 4 (4M vs 2M for Sonnet) | No adaptive thinking — fixed reasoning effort |
| Lowest cost ($1/$5 per MTok) | 200k context only — cannot process entire large codebases in one call |
| Fast, low latency | Knowledge cutoff Feb 2025 (older than Sonnet) |
| Sufficient for structured generation tasks | Higher minimum cache threshold (4,096 tokens) |
| Same API as Sonnet — one key, one billing | Quality ceiling — noticeably weaker on complex multi-step reasoning |

#### Sonnet 4.6 — Advantages & Disadvantages

| Advantages | Disadvantages |
|---|---|
| 91% BullshitBench v2 pushback — highest of all tested | 3× more expensive than Haiku on every token |
| 1M token context window | Sonnet 4.x ITPM pool shared with Sonnet 4.5 and Sonnet 4 |
| Adaptive thinking — scales reasoning effort dynamically | 300k output only available via Batch API (not sync) |
| 300k output tokens per request (Batch + beta header) | Same sync output ceiling as Haiku (64k) |
| Knowledge current to Aug 2025 | Rate limits are maximums not SLAs — spikes trigger 429s |
| Lower minimum cache threshold (2,048 tokens) | |

---

### 2. Groq API — Qwen3 32B (Emergency Fallback)

**Model correction:** `Qwen3.5 397B` does not exist on Groq. Available Qwen models: `qwen/qwen3-32b` (131k context) and `qwen-qwq-32b` (128k context). Both are **Preview** status — not Production SLA.

#### Rate Limits

| Tier | RPM | TPM | TPD |
|---|---|---|---|
| Free | 60 | 6,000 | 500,000 |
| Developer (paid) | ~300–600 (~10× free) | ~60,000 | Higher (org-level) |
| Developer discount | — | — | 25% off token prices |

#### Speed & Pricing

| Metric | Value |
|---|---|
| Output speed | 350–662 tokens/second |
| Time to first token | 0.23–0.71 seconds |
| Input price | $0.29/MTok |
| Output price | $0.59/MTok (Qwen3 32B) |
| Batch/cached discount | 50% off |
| Context window | 131,072 tokens |
| Max output | 40,960 tokens |

#### Groq — Advantages & Disadvantages

| Advantages | Disadvantages |
|---|---|
| 350–662 t/s — fastest inference for Qwen3-32B by large margin | Both Qwen models are **Preview** — can be removed without notice |
| OpenAI-compatible API (drop-in `base_url` change) | 40,960 max output tokens despite 131k context |
| Much cheaper than Anthropic ($0.29/$0.59 vs $3/$15) | Free tier TPM (6,000) too low for production use |
| Full 131k context window (competitors cap it lower) | No `logprobs`, no `n>1` — breaks some drop-in apps |
| Thinking mode support (`reasoning_format` parameter) | Temperature of exactly 0 not supported (auto-set to 1e-8) |
| Separate infrastructure from Anthropic — genuine redundancy | LPU hardware: large models need hundreds of chips, complex failure surface |
| Free tier available indefinitely | Enterprise pricing opaque — contact sales beyond Developer tier |

---

### 3. Google Gemini Embeddings — gemini-embedding-001

**Model correction:** `text-embedding-004` was deprecated January 14, 2026 and `embedding-001` retired August 14, 2025. `gemini-embedding-001` is the current model (GA since July 14, 2025).

#### Rate Limits

| Tier | RPM | RPD | TPM |
|---|---|---|---|
| Free | ~5 RPM | ~1,500 RPD | Not published |
| Paid (any billing account) | Higher (project-specific, check AI Studio dashboard) | No cap | ~5,000,000 tokens/min (Vertex AI regional) |

Google does not publish embedding-specific rate limit tables publicly — check your project quota dashboard.

#### Model Specs

| Property | gemini-embedding-001 |
|---|---|
| Default output dimensions | **3072** (not 768) |
| Configurable dimensions (MRL) | 768, 1536, or 3072 |
| Max input tokens | **2,048 tokens** |
| Batch embed (same call) | Yes — `batchEmbedContents` endpoint |
| Pricing (paid) | $0.15/MTok input |
| Pricing (batch async) | $0.075/MTok (50% off) |
| Free tier data policy | Google uses your data for model training |
| Paid tier data policy | Your data is **not** used for training |

**Storage implication:** Switching from 768 to 3072 dimensions multiplies embedding storage by 4×. At current library scale (100 books, ~280MB total DB), this is still manageable (~1.1GB). Use `output_dimensionality=768` in API calls to keep storage equivalent to text-embedding-004.

#### Gemini Embeddings — Advantages & Disadvantages

| Advantages | Disadvantages |
|---|---|
| Free tier (no credit card required) | Free tier uses data for training — must switch to paid before any real user data |
| Top MTEB multilingual leaderboard (March 2025) | Max 2,048 input tokens — chunks exceeding this are truncated |
| MRL dimension flexibility (3072/1536/768) without quality loss | Rate limits not publicly documented — opaque, project-specific |
| Task type parameter improves RAG quality (RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY) | ~30ms latency vs ~25ms for OpenAI |
| Stronger multilingual than OpenAI 3-large (+1.7pp MTEB) | Weaker on code retrieval (-2.7pp vs OpenAI 3-large) |
| Integrated with Google Cloud ecosystem | Switching models requires re-embedding all chunks (incompatible spaces) |

---

### 4. Supabase

#### Free vs Pro Tier

| Limit | Free | Pro ($25/month) |
|---|---|---|
| Database storage | 500 MB | 8 GB ($0.125/GB after) |
| File storage | 1 GB | 100 GB ($0.021/GB after) |
| Egress / bandwidth | 5 GB | 250 GB ($0.09/GB DB, $0.03/GB cached after) |
| Max direct DB connections | 60 | 60 (Micro compute) |
| Max pooled connections (Supavisor) | 200 | 200 (Micro compute) — scales with compute tier |
| Auth MAU | 50,000 | 100,000 ($0.00325/MAU after) |
| Edge Function invocations/month | 500,000 | 2,000,000 ($2/million after) |
| Edge Function max execution | 150 seconds | 400 seconds |
| Realtime concurrent connections | 200 | 500 |
| Project inactivity pause | **After 7 days** | **Never** |
| Daily backups | No | Yes |
| Custom domains | No | Yes |

#### pgvector Hard Limits (both tiers — extension constraint)

| Index type | Max dimensions |
|---|---|
| HNSW index | 2,000 dimensions (`vector`) |
| IVFFlat index | 2,000 dimensions (`vector`) |
| No index (storage only) | 16,000 dimensions |

768-dimension embeddings are well within the 2,000-dimension HNSW index limit.

#### Supabase — Advantages & Disadvantages

| Advantages | Disadvantages |
|---|---|
| pgvector built-in — no separate vector DB needed | **Free tier pauses after 7 days inactivity** — cold start on next request, unusable for production |
| Auth, Storage, Realtime, Edge Functions all included | Only 2 projects on free tier |
| Generous Pro tier (8GB DB, 100GB storage) | 60 direct / 200 pooled connections on Micro compute — tight for concurrent production |
| Point-in-time recovery on Pro | Shared compute on free tier — noisy neighbor risk |
| Supabase Storage signed URL generation is simple | 5 GB egress on free tier is easily exceeded |
| SQL-first — full PostgreSQL, no ORM lock-in | No built-in Redis / caching layer |

**Trigger for Pro:** The 7-day pause policy alone makes Free unusable for production. Go Pro before any real users. At ~50 active users storage and egress will also exceed Free limits.

---

### 5. Cloudflare Tunnel (Free Plan)

#### Limits & Specifications

| Parameter | Value |
|---|---|
| Bandwidth | Unmetered (no cap — ToS prohibits video streaming content) |
| Concurrent in-flight requests (Quick Tunnels) | 200 — returns 429 beyond this |
| Origin TCP connect timeout | 19 seconds |
| Proxy read timeout | 120 seconds — **not configurable on free/pro** |
| Proxy write timeout | 30 seconds |
| Proxy idle timeout | 900 seconds |
| URL length limit | 16 KB |
| Latency overhead | **15–45 ms additional** vs direct connection |
| WebSocket support | Yes |
| HTTP/3 (QUIC) support | Yes |
| SSE (GET-based) | **BROKEN — buffered, not streamed** |

#### CRITICAL — SSE Buffering Bug

GET-based Server-Sent Events are buffered through Cloudflare Tunnel — the entire response is held and flushed only when the server closes the connection. This breaks real-time streaming of LLM tokens, live feedback, and any SSE-based feature. Headers (`Cache-Control: no-store`, `X-Accel-Buffering: no`) do not fix this — buffering occurs at Cloudflare's edge, not the origin. GitHub issue #1449, reported April 2025, **unresolved as of May 2026**.

**Impact on this project:** If the evaluation feedback or goal chatbot streams tokens via SSE GET, it will not stream — it will appear to hang and then dump all at once. Use POST-based streaming or WebSocket for any streaming endpoint.

#### Cloudflare Tunnel — Advantages & Disadvantages

| Advantages | Disadvantages |
|---|---|
| No open inbound ports — VPS attack surface is minimal | GET-based SSE is broken (buffered) — GitHub #1449 unresolved |
| Real server IP never exposed | 120s proxy read timeout — long requests will 524, not configurable on free |
| SSL automatic with trusted certificates | Adds 15–45 ms latency per request |
| No Nginx SSL termination config needed | Service availability depends on Cloudflare uptime |
| Built-in basic DDoS protection | ToS prohibits using Tunnel primarily for video streaming |
| Free on Cloudflare free plan | Quick Tunnels capped at 200 concurrent requests |
| Cloudflare Access (free up to 50 users) for admin panel | |

---

### 6. GitHub Actions (Free Tier)

#### Limits

| Limit | Free (private repo) | Free (public repo) |
|---|---|---|
| Minutes/month | **2,000** | **Unlimited** |
| Concurrent jobs | 20 | 20 |
| Job timeout | 6 hours | 6 hours |
| Artifact storage | 500 MB | 500 MB |
| Cache storage | 10 GB | 10 GB |
| Cache eviction | After 7 days no access | After 7 days no access |
| `GITHUB_TOKEN` API rate | 1,000 requests/hour per repo | 1,000 requests/hour per repo |
| Matrix job max | 256 | 256 |

**Minute multipliers:** Windows runners = 2× minutes, macOS = 10× minutes. Linux is 1×. SSH deploy workflows use Linux — no multiplier.

**Burn rate for this project:** If the repo is private, ~3 min per deploy × 10 deploys/month = 30 min/month. Well within 2,000 minutes.

#### GitHub Actions — Advantages & Disadvantages

| Advantages | Disadvantages |
|---|---|
| Unlimited minutes for public repos | Private SSH keys stored as Secrets — 48 KB max, exfiltration risk if repo compromised |
| Simple YAML config, excellent documentation | No passphrase support natively — unencrypted keys required |
| Deep GitHub integration — triggers on push, PR, tag | No built-in deployment approval gates on free tier |
| 2,000 free minutes/month covers this deploy frequency | 500 MB artifact storage — fills up with Docker layer caching |
| Free for this project's likely deploy frequency | Runner IP ranges are published and change — firewall allow-listing is fragile |
| | Key rotation is manual — no automated rotation |

---

### 7. Hetzner CPX21

#### Specs

| Spec | Value |
|---|---|
| vCPUs | 3 AMD EPYC (shared) |
| RAM | 4 GB |
| NVMe SSD | 80 GB |
| Network port | Up to 10 Gbps (shared) |
| Monthly traffic (EU) | 20 TB included |
| Monthly traffic (Singapore) | **~1–2 TB included** |
| Traffic overage | ~€7.40/TB |
| Uptime SLA | 99.9% (credits only, not cash) |

#### Price Discrepancy — Important

The $16/month figure in this document is the **EU price** (Frankfurt/Nuremberg/Helsinki at ~€9.49/month ≈ $10.50 USD). **Hetzner CPX21 in Singapore is approximately $25.38 USD/month** — roughly 2.4× the EU rate. Verify the exact current price in the Hetzner console before committing.

If the $16 budget is firm, options are:
1. Use the EU region (Frankfurt or Helsinki) + rely on Cloudflare's global CDN for low latency to Sri Lanka — latency difference is modest and Cloudflare edge PoPs handle most static content
2. Upgrade to CPX31 Singapore (~$45/month) for 8 GB RAM if the Singapore location is required

| | CPX21 EU | CPX21 Singapore | CPX31 Singapore |
|---|---|---|---|
| vCPU / RAM | 3 / 4 GB | 3 / 4 GB | 4 / 8 GB |
| Storage | 80 GB | 80 GB | 160 GB |
| Traffic | 20 TB | ~1–2 TB | ~1–2 TB |
| Price | ~$10.50/month | ~$25.38/month | ~$45/month |

#### Hetzner CPX21 — Advantages & Disadvantages

| Advantages | Disadvantages |
|---|---|
| 4 GB RAM — handles PyMuPDF + LangChain ingestion without crashing | vCPU is **shared** — sustained CPU-heavy tasks may be throttled by noisy neighbors |
| Fixed monthly cost — no per-request billing surprises | Singapore traffic cap (~1–2 TB) vs EU (20 TB) — bandwidth overages at €7.40/TB |
| Full root access — full Docker control | Singapore price (~$25.38/month) is 2.4× the EU price |
| 80 GB NVMe — enough for Docker images, logs, and runtime data | 99.9% SLA pays credits only, not cash refunds |
| 99.9% uptime SLA | Shared CPU — not suitable for sustained CPU-intensive workloads (use CCX series for dedicated) |
| Hetzner's network is reliable and fast within the region | Support is ticket-only — no phone support |

---

### What Was Added / Removed (v4.0)

| Change | Detail |
|---|---|
| **Added** | Full rate limits section for all 7 services |
| **Fixed** | Embedding model: `text-embedding-004` → `gemini-embedding-001` throughout |
| **Fixed** | Qwen model: `Qwen3.5 397B` → `qwen/qwen3-32b` (Qwen3.5 397B does not exist on Groq) |
| **Flagged** | Hetzner Singapore price discrepancy: ~$25.38/month, not $16 (that is the EU rate) |
| **Flagged** | Cloudflare Tunnel GET-based SSE is broken — architectural impact on streaming endpoints |
| **Flagged** | Groq Qwen models are Preview status — no Production SLA |
| **Flagged** | Supabase Free tier pauses after 7 days — go Pro before production |
| **Fixed** | Security scan section: updated from Railway + Vercel → Hetzner + Cloudflare Tunnel URLs |

---

## Summary Table

| Item | Monthly cost (USD) | Monthly cost (LKR) | Notes |
|---|---|---|---|
| Claude Haiku 4.5 | ~$3–25 | ~LKR 940–7,850 | Scales with question volume |
| Claude Sonnet 4.6 | ~$9–83 | ~LKR 2,830–26,000 | Evaluation + verification (~20% trigger rate) |
| Qwen3 32B (Groq) | ~$0 | ~LKR 0 | Emergency fallback only — negligible in practice |
| Grok 4.3 | Removed | — | BullshitBench v2: 50% pushback — disqualified |
| Gemini embedding-001 | <$1 | <LKR 315 | One-time per book, negligible |
| Supabase | $0–25 | LKR 0–7,850 | Free until ~50 active users |
| Hetzner CPX21 Singapore | ~$25 (see note) | ~LKR 7,850 | $16 is EU price — Singapore is ~$25.38/month |
| Cloudflare Tunnel + DNS + SSL | $0 | LKR 0 | Free, both subdomains |
| GitHub Actions CI/CD | $0 | LKR 0 | SSH deploy on push to main |
| Vercel | Removed | — | Frontend now on Hetzner via Nginx Docker |
| Railway | Removed | — | 512MB RAM insufficient for ingestion |
| Domain | ~$1 | ~LKR 315 | Annual cost averaged monthly |
| **Total (small)** | **~$57** | **~LKR 17,900** | Up to 50 users |
| **Total (medium)** | **~$202** | **~LKR 63,400** | 50–200 users |
| **Total (large)** | **~$442** | **~LKR 138,800** | 200–500 users |