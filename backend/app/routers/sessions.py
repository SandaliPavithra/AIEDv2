import asyncio
import json
import random
import uuid
from datetime import datetime, timezone
from typing import Annotated

from anthropic import RateLimitError
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import get_current_user
from app.config import CLAUDE_GENERATION_MODEL, GENERATION_CONFIG
from app.logging_config import logger
from app.models.question import QuestionResponse
from app.models.session import CreateSessionRequest, SessionResponse
from app.services.generation import generate_question
from app.services.rag import hybrid_search
from app.supabase_rest import rest_get, rest_get_one, rest_patch, rest_post, rest_post_one, rest_rpc

router = APIRouter()

# The retrieved pool needs to be much larger than `count`, and sampled
# randomly rather than taken in rank order — otherwise the same top-K chunks
# (ranked by relevance to the topic's bare name) get reused for every session,
# no matter how large the book is. Confirmed live: with top_k_rag=5 and
# count=5, `selected` was literally chunks[0..4] every single time.
_POOL_MULTIPLIER = 6
_MIN_POOL_SIZE = 30

# Chunks are attempted in small concurrent batches rather than all at once —
# large enough to cut wall-clock time meaningfully, small enough to stay
# well clear of Claude's per-minute rate limits.
_GENERATION_BATCH_SIZE = 5

# Sentinel distinct from both a real question dict and None (generic failure)
# — signals the whole pool should stop being attempted, not just this chunk,
# since a rate-limit hit means every remaining call in this batch is also
# doomed to fail.
_RATE_LIMITED = object()


@router.post("/", response_model=SessionResponse)
async def create_session(
    req: CreateSessionRequest,
    background_tasks: BackgroundTasks,
    user: Annotated[dict, Depends(get_current_user)],
):
    config = GENERATION_CONFIG[req.difficulty]

    # started_at is omitted so the column's DEFAULT now() applies — sending an
    # explicit null would violate its NOT NULL constraint.
    session = await rest_post_one(
        "test_sessions",
        json={
            "user_id": str(user["id"]),
            "topic_id": str(req.topic_id),
            "difficulty": req.difficulty,
            "total_questions": req.total_questions,
            "status": "in_progress",
            "generation_temperature": config["temperature"],
            "generation_top_p": config["top_p"],
            "retrieval_top_k": config["top_k_rag"],
        },
    )

    background_tasks.add_task(
        _generate_session_questions,
        session["id"],
        req.topic_id,
        req.difficulty,
        req.question_type,
        req.total_questions,
        config["top_k_rag"],
    )

    return SessionResponse(**session)


async def _generate_session_questions(
    session_id: uuid.UUID,
    topic_id: uuid.UUID,
    difficulty: str,
    question_type: str,
    count: int,
    top_k: int,
) -> None:
    logger.info(
        "[sessions.py] Generating %d question(s) for session %s (topic_id=%s, difficulty=%s, type=%s)",
        count, session_id, topic_id, difficulty, question_type,
    )
    topic = await rest_get_one("topics", params={"id": f"eq.{topic_id}", "select": "name"})
    if not topic:
        logger.warning("[sessions.py] Topic %s not found — no questions will be generated for session %s", topic_id, session_id)
        return

    query_text = topic["name"]
    pool_size = max(count * _POOL_MULTIPLIER, _MIN_POOL_SIZE)
    chunks = await hybrid_search(query_text, difficulty if difficulty != "mixed" else None, pool_size)
    logger.info(
        "[sessions.py] hybrid_search found %d candidate chunk(s) for topic %r, difficulty=%s (pool_size=%d)",
        len(chunks), query_text, difficulty, pool_size,
    )
    if not chunks:
        logger.warning(
            "[sessions.py] Zero chunks matched — likely no ingested content tagged difficulty=%s for this topic. "
            "Session %s will end up with 0 questions.", difficulty, session_id,
        )
        return

    # Randomize draw order so different sessions explore different parts of
    # the book instead of always hitting the same highest-ranked chunks.
    random.shuffle(chunks)

    generated = 0
    skipped = 0
    failed = 0
    for batch_start in range(0, len(chunks), _GENERATION_BATCH_SIZE):
        if generated >= count:
            break

        batch = chunks[batch_start:batch_start + _GENERATION_BATCH_SIZE]
        qtypes = [
            random.choice(["short_answer", "long_answer", "mcq"]) if question_type == "mixed" else question_type
            for _ in batch
        ]
        results = await asyncio.gather(*(
            _attempt_question(chunk, qtype, difficulty if difficulty != "mixed" else "medium", topic["name"], session_id)
            for chunk, qtype in zip(batch, qtypes)
        ))

        rate_limited = False
        for chunk, q in zip(batch, results):
            if q is _RATE_LIMITED:
                rate_limited = True
                continue
            if q is None:
                failed += 1
                continue
            if q.get("skip"):
                skipped += 1
                logger.info(
                    "[sessions.py] Skipped chunk %s (pages %s-%s, not substantive subject matter)",
                    chunk.get("id"), chunk.get("page_start"), chunk.get("page_end"),
                )
                continue
            if generated >= count:
                continue

            await rest_post(
                "questions",
                json={
                    "session_id": str(session_id),
                    "chunk_id": chunk["id"],
                    "topic_id": chunk.get("topic_id"),
                    "question_text": q["question_text"],
                    "question_type": q["question_type"],
                    "difficulty": difficulty,
                    "options": q.get("options"),
                    "correct_index": q.get("correct_index"),
                    "expected_concepts": q["expected_concepts"],
                    "expected_time_seconds": q["expected_time_seconds"],
                    "citation_book": chunk.get("book_title"),
                    "citation_author": chunk.get("book_author"),
                    "citation_chapter": chunk.get("chapter"),
                    "citation_page_start": chunk.get("page_start"),
                    "citation_page_end": chunk.get("page_end"),
                    "model_used": CLAUDE_GENERATION_MODEL,
                },
            )
            generated += 1

        if rate_limited:
            logger.warning(
                "[sessions.py] Claude rate limit hit for session %s — stopping early with "
                "%d/%d question(s) instead of burning through the rest of the pool on calls likely to fail",
                session_id, generated, count,
            )
            break

    logger.info(
        "[sessions.py] Session %s: generated %d/%d question(s) — %d skipped (non-substantive), %d failed, "
        "drawn from a pool of %d candidate chunk(s)",
        session_id, generated, count, skipped, failed, len(chunks),
    )


async def _attempt_question(
    chunk: dict,
    question_type: str,
    difficulty: str,
    topic_name: str,
    session_id: uuid.UUID,
):
    # Catches its own exception so one bad chunk in a gather() batch doesn't abort its siblings.
    try:
        return await generate_question(chunk, question_type, difficulty, topic_name)
    except RateLimitError:
        return _RATE_LIMITED
    except Exception:
        logger.exception(
            "[sessions.py] generate_question failed for session %s, chunk %s — trying a different chunk",
            session_id, chunk.get("id"),
        )
        return None


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    row = await rest_get_one(
        "test_sessions",
        params={"id": f"eq.{session_id}", "user_id": f"eq.{user['id']}"},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**row)


# correct_index is deliberately excluded — this endpoint is the quiz-taking
# surface and must never leak the answer key to the frontend.
_QUIZ_QUESTION_FIELDS = (
    "id,session_id,chunk_id,topic_id,question_text,question_type,difficulty,"
    "options,expected_concepts,expected_time_seconds,citation_book,citation_author,"
    "citation_chapter,citation_page_start,citation_page_end,model_used,created_at"
)


@router.get("/{session_id}/questions", response_model=list[QuestionResponse])
async def get_session_questions(
    session_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    rows = await rest_get(
        "questions",
        params={
            "session_id": f"eq.{session_id}",
            "order": "created_at.asc",
            "select": _QUIZ_QUESTION_FIELDS,
        },
    )
    for r in rows:
        if isinstance(r.get("expected_concepts"), str):
            r["expected_concepts"] = json.loads(r["expected_concepts"])
        if isinstance(r.get("options"), str):
            r["options"] = json.loads(r["options"])
    return [QuestionResponse(**r) for r in rows]


@router.post("/{session_id}/complete", response_model=SessionResponse)
async def complete_session(
    session_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    avg = await rest_rpc("session_avg_final_score", {"p_session_id": str(session_id)})

    rows = await rest_patch(
        "test_sessions",
        params={"id": f"eq.{session_id}", "user_id": f"eq.{user['id']}"},
        json={
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "overall_score": avg,
        },
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found")
    row = rows[0]

    asyncio.create_task(_snapshot_progress(session_id, user["id"]))

    return SessionResponse(**row)


async def _snapshot_progress(session_id: uuid.UUID, user_id: uuid.UUID) -> None:
    question_rows = await rest_get(
        "questions",
        params={"session_id": f"eq.{session_id}", "topic_id": "not.is.null", "select": "topic_id"},
    )
    topic_ids = {r["topic_id"] for r in question_rows}

    for tid in topic_ids:
        stats = await rest_rpc(
            "topic_progress_stats",
            {"p_session_id": str(session_id), "p_topic_id": tid, "p_user_id": str(user_id)},
        )
        if not stats:
            continue
        # RPC returning TABLE(...) comes back as a list with one row here.
        stats = stats[0] if isinstance(stats, list) else stats
        if stats.get("questions_attempted") in (None, 0):
            continue

        await rest_post(
            "progress_snapshots_decrypted",
            json={
                "user_id": str(user_id),
                "topic_id": tid,
                "avg_factual_correctness": stats["avg_factual_correctness"],
                "avg_structure": stats["avg_structure"],
                "avg_accuracy": stats["avg_accuracy"],
                "avg_precision": stats["avg_precision"],
                "avg_recall": stats["avg_recall"],
                "avg_wording": stats["avg_wording"],
                "avg_raw_score": stats["avg_raw_score"],
                "avg_final_score": stats["avg_final_score"],
                "avg_time_modifier": stats["avg_time_modifier"],
                "dominant_behaviour": stats["dominant_behaviour"],
                "questions_attempted": stats["questions_attempted"],
                "sessions_completed": stats["sessions_completed"],
                "goal_proximity": None,
            },
        )
