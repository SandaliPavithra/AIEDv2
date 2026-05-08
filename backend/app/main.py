from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_pool, get_pool
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    yield
    await close_pool()


app = FastAPI(title="AI Education Platform API", version="1.0.0", lifespan=lifespan)

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(documents.router, prefix="/documents", tags=["documents"])
app.include_router(topics.router, prefix="/topics", tags=["topics"])
app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
app.include_router(answers.router, prefix="/answers", tags=["answers"])
app.include_router(evaluations.router, prefix="/evaluations", tags=["evaluations"])
app.include_router(goals.router, prefix="/goals", tags=["goals"])
app.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
app.include_router(progress.router, prefix="/progress", tags=["progress"])


@app.get("/health")
async def health():
    return {"status": "ok"}
