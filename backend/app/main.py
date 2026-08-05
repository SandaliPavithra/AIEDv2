import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.logging_config import RequestLoggingMiddleware, logger, setup_logging
from app.routers import (
    answers,
    auth,
    deep_evaluation,
    documents,
    evaluations,
    goals,
    logs,
    progress,
    recommendations,
    sessions,
    topics,
)
from app.supabase_rest import rest_get, rest_patch

setup_logging()

_startup_time = time.time()

app = FastAPI(title="AI Education Platform API", version="1.0.0")

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLoggingMiddleware)


@app.on_event("startup")
async def reconcile_stuck_ingestion() -> None:
    """ingestion_status is written by an in-memory BackgroundTasks coroutine —
    it has no idea whether the process behind it is still alive. If that
    process dies mid-run (killed terminal, crash, manual restart), the status
    just freezes at whatever it last said, forever, with nothing actually
    running. A cold process start has zero in-memory tasks by definition, so
    any document still marked pending/processing from before this boot is
    guaranteed stale — never something genuinely in progress. Correct it
    immediately on every startup so the field never lies about current state."""
    stuck = await rest_get("documents", params={"ingestion_status": "in.(pending,processing)", "select": "id,title"})
    if not stuck:
        return
    for doc in stuck:
        logger.warning(
            "[main.py] Resetting stale ingestion_status for document %s (%r) — interrupted previous run",
            doc["id"], doc["title"],
        )
    await rest_patch(
        "documents", params={"ingestion_status": "in.(pending,processing)"}, json={"ingestion_status": "failed"}
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Starlette hoists a handler registered for the bare `Exception` class into
    # ServerErrorMiddleware, which sits OUTSIDE every user-added middleware —
    # including CORSMiddleware. So this handler's response never passes through
    # CORSMiddleware, and the browser reports a masking "CORS blocked" error
    # instead of the real 500. The only fix is to attach the CORS headers here,
    # by hand, on this response directly.
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    origin = request.headers.get("origin")
    headers = {}
    if origin in origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(status_code=500, content={"detail": "Internal server error"}, headers=headers)


app.include_router(auth.router,            prefix="/auth",            tags=["auth"])
app.include_router(documents.router,       prefix="/documents",       tags=["documents"])
app.include_router(topics.router,          prefix="/topics",          tags=["topics"])
app.include_router(sessions.router,        prefix="/sessions",        tags=["sessions"])
app.include_router(answers.router,         prefix="/answers",         tags=["answers"])
app.include_router(evaluations.router,     prefix="/evaluations",     tags=["evaluations"])
app.include_router(deep_evaluation.router, prefix="/deep-evaluation", tags=["deep-evaluation"])
app.include_router(goals.router,           prefix="/goals",           tags=["goals"])
app.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
app.include_router(progress.router,        prefix="/progress",        tags=["progress"])
app.include_router(logs.router,            prefix="/logs",            tags=["logs"])


@app.get("/health", tags=["monitoring"])
async def health():
    """
    Liveness + readiness probe.
    Checks Supabase REST connectivity (Accept-Profile: aied + service key).
    Suitable for a load-balancer health check (returns 200 only if reachable).
    """
    uptime_s = round(time.time() - _startup_time, 1)
    db_status = "ok"
    db_detail: str | None = None

    try:
        await rest_get("topics", params={"select": "id", "limit": "1"})
    except Exception as exc:
        db_status = "error"
        db_detail = str(exc)

    status = "ok" if db_status == "ok" else "degraded"

    return {
        "status": status,
        "uptime_seconds": uptime_s,
        "db": {"status": db_status, "detail": db_detail},
        "version": "1.0.0",
    }


@app.get("/health/ai", tags=["monitoring"])
async def health_ai():
    """
    Check each AI provider is reachable.
    Performs a minimal live call to each API.
    Use this for debugging, not for load-balancer probes.
    """
    from anthropic import AsyncAnthropic
    from openai import AsyncOpenAI

    results: dict[str, dict] = {}

    # Claude (question generation, evaluation, goal chat)
    try:
        anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        await anthropic_client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=1,
            messages=[{"role": "user", "content": "ping"}],
        )
        results["anthropic"] = {"status": "ok"}
    except Exception as exc:
        results["anthropic"] = {"status": "error", "detail": str(exc)[:200]}

    # Local embeddings (BAAI/bge-base-en-v1.5, runs in-process — not a network call)
    try:
        from app.services.embedding import embed
        await embed("ping", "RETRIEVAL_QUERY")
        results["local_embeddings"] = {"status": "ok"}
    except Exception as exc:
        results["local_embeddings"] = {"status": "error", "detail": str(exc)[:200]}

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
