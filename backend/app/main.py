import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_pool, get_pool
from app.logging_config import RequestLoggingMiddleware, logger, setup_logging
from app.routers import (
    answers,
    auth,
    documents,
    evaluations,
    goals,
    progress,
    recommendations,
    sessions,
    topics,
)

setup_logging()

_startup_time = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await get_pool()
        logger.info("DB pool initialised")
    except Exception as exc:
        logger.warning("DB pool unavailable at startup: %s", exc)
    yield
    await close_pool()
    logger.info("DB pool closed")


app = FastAPI(title="AI Education Platform API", version="1.0.0", lifespan=lifespan)

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(auth.router,            prefix="/auth",            tags=["auth"])
app.include_router(documents.router,       prefix="/documents",       tags=["documents"])
app.include_router(topics.router,          prefix="/topics",          tags=["topics"])
app.include_router(sessions.router,        prefix="/sessions",        tags=["sessions"])
app.include_router(answers.router,         prefix="/answers",         tags=["answers"])
app.include_router(evaluations.router,     prefix="/evaluations",     tags=["evaluations"])
app.include_router(goals.router,           prefix="/goals",           tags=["goals"])
app.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
app.include_router(progress.router,        prefix="/progress",        tags=["progress"])


@app.get("/health", tags=["monitoring"])
async def health():
    """
    Liveness + readiness probe.
    Checks DB connectivity and reports pool stats.
    Suitable for a load-balancer health check (returns 200 only if DB is reachable).
    """
    import asyncpg

    uptime_s = round(time.time() - _startup_time, 1)
    db_status = "ok"
    db_detail: str | None = None
    pool_stats: dict | None = None

    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        pool_stats = {
            "min_size": pool.get_min_size(),
            "max_size": pool.get_max_size(),
            "size":     pool.get_size(),
            "idle":     pool.get_idle_size(),
        }
    except Exception as exc:
        db_status = "error"
        db_detail = str(exc)

    status = "ok" if db_status == "ok" else "degraded"

    return {
        "status": status,
        "uptime_seconds": uptime_s,
        "db": {"status": db_status, "detail": db_detail, "pool": pool_stats},
        "version": "1.0.0",
    }


@app.get("/health/ai", tags=["monitoring"])
async def health_ai():
    """
    Check each AI provider is reachable.
    Performs a minimal live call to each API.
    Use this for debugging, not for load-balancer probes.
    """
    from openai import AsyncOpenAI
    from google import genai as google_genai

    results: dict[str, dict] = {}

    # Claude via Bedrock
    try:
        from anthropic import AsyncAnthropicBedrockMantle
        bclient = AsyncAnthropicBedrockMantle(aws_region=settings.AWS_REGION)
        await bclient.messages.create(
            model="anthropic.claude-haiku-4-5",
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
        results["anthropic_bedrock"] = {"status": "ok"}
    except Exception as exc:
        results["anthropic_bedrock"] = {"status": "error", "detail": str(exc)[:200]}

    # Google embeddings
    try:
        gclient = google_genai.Client(api_key=settings.GOOGLE_API_KEY)
        gclient.models.embed_content(
            model="models/text-embedding-004",
            contents="ping",
        )
        results["google"] = {"status": "ok"}
    except Exception as exc:
        results["google"] = {"status": "error", "detail": str(exc)[:200]}

    # xAI Grok
    try:
        xclient = AsyncOpenAI(
            api_key=settings.XAI_API_KEY,
            base_url="https://api.x.ai/v1",
        )
        await xclient.chat.completions.create(
            model="grok-2-latest",
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
        results["xai"] = {"status": "ok"}
    except Exception as exc:
        results["xai"] = {"status": "error", "detail": str(exc)[:200]}

    overall = "ok" if all(v["status"] == "ok" for v in results.values()) else "degraded"
    return {"status": overall, "providers": results}
