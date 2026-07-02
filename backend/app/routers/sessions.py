import json
import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import get_current_user
from app.config import GENERATION_CONFIG
from app.database import get_pool
from app.models.question import QuestionResponse
from app.models.session import CreateSessionRequest, SessionResponse
from app.services.generation import generate_question
from app.services.rag import hybrid_search

router = APIRouter()


@router.post("/", response_model=SessionResponse)
async def create_session(
    req: CreateSessionRequest,
    background_tasks: BackgroundTasks,
    user: Annotated[dict, Depends(get_current_user)],
):
    config = GENERATION_CONFIG[req.difficulty]
    pool = await get_pool()

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO test_sessions
              (id, user_id, topic_id, difficulty, total_questions, status,
               generation_temperature, generation_top_p, retrieval_top_k, started_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, 'in_progress', $5, $6, $7, now())
            RETURNING *
            """,
            user["id"], req.topic_id, req.difficulty, req.total_questions,
            config["temperature"], config["top_p"], config["top_k_rag"],
        )

    session = dict(row)
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
    pool = await get_pool()

    async with pool.acquire() as conn:
        topic = await conn.fetchrow("SELECT name FROM topics WHERE id = $1", topic_id)
    if not topic:
        return

    query_text = topic["name"]
    chunks = await hybrid_search(pool, query_text, difficulty if difficulty != "mixed" else None, top_k)

    # Cycle through chunks if fewer than requested
    selected: list[dict] = []
    for i in range(count):
        if not chunks:
            break
        selected.append(chunks[i % len(chunks)])

    for chunk in selected:
        qtype = question_type
        if question_type == "mixed":
            import random
            qtype = random.choice(["short_answer", "long_answer", "mcq"])

        try:
            q = await generate_question(chunk, qtype, difficulty if difficulty != "mixed" else "medium")
        except Exception:
            continue

        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO questions
                  (id, session_id, chunk_id, topic_id, question_text, question_type,
                   difficulty, expected_concepts, expected_time_seconds,
                   citation_book, citation_author, citation_chapter,
                   citation_page_start, citation_page_end, model_used, created_at)
                VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,now())
                """,
                session_id, chunk["id"], chunk.get("topic_id"),
                q["question_text"], q["question_type"], difficulty,
                json.dumps(q["expected_concepts"]), q["expected_time_seconds"],
                chunk.get("book_title"), chunk.get("book_author"), chunk.get("chapter"),
                chunk.get("page_start"), chunk.get("page_end"),
                "claude-haiku-4-5-20251001",
            )


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM test_sessions WHERE id = $1 AND user_id = $2",
            session_id, user["id"],
        )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**dict(row))


@router.get("/{session_id}/questions", response_model=list[QuestionResponse])
async def get_session_questions(
    session_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM questions WHERE session_id = $1 ORDER BY created_at",
            session_id,
        )
    return [QuestionResponse(**dict(r)) for r in rows]


@router.post("/{session_id}/complete", response_model=SessionResponse)
async def complete_session(
    session_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Compute overall score from evaluations
        avg = await conn.fetchval(
            """
            SELECT AVG(e.final_score)
            FROM evaluations e
            JOIN questions q ON e.question_id = q.id
            WHERE q.session_id = $1
            """,
            session_id,
        )
        row = await conn.fetchrow(
            """
            UPDATE test_sessions
            SET status = 'completed', completed_at = now(), overall_score = $2
            WHERE id = $1 AND user_id = $3
            RETURNING *
            """,
            session_id, avg, user["id"],
        )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    import asyncio
    asyncio.create_task(_snapshot_progress(session_id, user["id"]))

    return SessionResponse(**dict(row))


async def _snapshot_progress(session_id: uuid.UUID, user_id: uuid.UUID) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        topic_ids = await conn.fetch(
            "SELECT DISTINCT topic_id FROM questions WHERE session_id = $1 AND topic_id IS NOT NULL",
            session_id,
        )
        for row in topic_ids:
            tid = row["topic_id"]
            stats = await conn.fetchrow(
                """
                SELECT
                  AVG(e.factual_correctness_score) AS avg_factual_correctness,
                  AVG(e.structure_score)           AS avg_structure,
                  AVG(e.accuracy_score)            AS avg_accuracy,
                  AVG(e.precision_score)           AS avg_precision,
                  AVG(e.recall_score)              AS avg_recall,
                  AVG(e.wording_score)             AS avg_wording,
                  AVG(e.raw_score)                 AS avg_raw_score,
                  AVG(e.final_score)               AS avg_final_score,
                  AVG(e.time_modifier)             AS avg_time_modifier,
                  COUNT(*)                         AS questions_attempted
                FROM evaluations e
                JOIN questions q ON e.question_id = q.id
                WHERE q.session_id = $1 AND q.topic_id = $2
                """,
                session_id, tid,
            )
            if not stats:
                continue

            sessions_count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM test_sessions
                WHERE user_id = $1 AND status = 'completed'
                """,
                user_id,
            )

            dominant = await conn.fetchval(
                """
                SELECT behaviour_label FROM answer_behaviour ab
                JOIN answers a ON ab.answer_id = a.id
                JOIN questions q ON a.question_id = q.id
                WHERE q.session_id = $1 AND q.topic_id = $2
                GROUP BY behaviour_label ORDER BY COUNT(*) DESC LIMIT 1
                """,
                session_id, tid,
            )

            await conn.execute(
                """
                INSERT INTO progress_snapshots
                  (id, user_id, topic_id, snapshot_date,
                   avg_factual_correctness, avg_structure, avg_accuracy,
                   avg_precision, avg_recall, avg_wording,
                   avg_raw_score, avg_final_score, avg_time_modifier,
                   dominant_behaviour, questions_attempted, sessions_completed, goal_proximity)
                VALUES (gen_random_uuid(),$1,$2,CURRENT_DATE,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL)
                ON CONFLICT (user_id, topic_id, snapshot_date) DO UPDATE SET
                  avg_factual_correctness = EXCLUDED.avg_factual_correctness,
                  avg_structure = EXCLUDED.avg_structure,
                  avg_accuracy = EXCLUDED.avg_accuracy,
                  avg_precision = EXCLUDED.avg_precision,
                  avg_recall = EXCLUDED.avg_recall,
                  avg_wording = EXCLUDED.avg_wording,
                  avg_raw_score = EXCLUDED.avg_raw_score,
                  avg_final_score = EXCLUDED.avg_final_score,
                  avg_time_modifier = EXCLUDED.avg_time_modifier,
                  dominant_behaviour = EXCLUDED.dominant_behaviour,
                  questions_attempted = EXCLUDED.questions_attempted,
                  sessions_completed = EXCLUDED.sessions_completed
                """,
                user_id, tid,
                stats["avg_factual_correctness"], stats["avg_structure"],
                stats["avg_accuracy"], stats["avg_precision"], stats["avg_recall"],
                stats["avg_wording"], stats["avg_raw_score"], stats["avg_final_score"],
                stats["avg_time_modifier"], dominant, stats["questions_attempted"],
                sessions_count,
            )
