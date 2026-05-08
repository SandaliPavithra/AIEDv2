import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.auth import get_current_user
from app.database import get_pool
from app.models.answer import (
    AnswerResponse,
    BehaviourResponse,
    SubmitAnswerRequest,
    SubmitEventsRequest,
)
from app.services.behaviour import compute_behaviour

router = APIRouter()


@router.post("/", response_model=AnswerResponse)
async def submit_answer(
    req: SubmitAnswerRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO answers (id, question_id, user_id, session_id, answer_text, submitted_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
            RETURNING *
            """,
            req.question_id, user["id"], req.session_id, req.answer_text,
        )
    return AnswerResponse(**dict(row))


@router.post("/{answer_id}/events", response_model=BehaviourResponse)
async def submit_events(
    answer_id: uuid.UUID,
    req: SubmitEventsRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        answer = await conn.fetchrow(
            "SELECT question_id FROM answers WHERE id = $1 AND user_id = $2",
            answer_id, user["id"],
        )
        if not answer:
            raise HTTPException(status_code=404, detail="Answer not found")

        question = await conn.fetchrow(
            "SELECT expected_time_seconds, session_id FROM questions WHERE id = $1",
            answer["question_id"],
        )
        if not question:
            raise HTTPException(status_code=404, detail="Question not found")

        # Insert raw events
        for ev in req.events:
            await conn.execute(
                """
                INSERT INTO question_events
                  (id, answer_id, user_id, question_id, session_id, event_type, event_at, expires_at)
                VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$6 + interval '30 days')
                """,
                answer_id, user["id"], answer["question_id"], question["session_id"],
                ev.event_type, ev.event_at,
            )

    events_list = [{"event_type": e.event_type, "event_at": e.event_at} for e in req.events]
    metrics = compute_behaviour(events_list, question["expected_time_seconds"])

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO answer_behaviour
              (id, answer_id, user_id, question_id, session_id,
               active_time_seconds, total_elapsed_seconds, pause_count,
               distraction_ratio, answer_start_delay_seconds, revision_count,
               behaviour_label, time_modifier)
            VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (answer_id) DO UPDATE SET
              active_time_seconds = EXCLUDED.active_time_seconds,
              total_elapsed_seconds = EXCLUDED.total_elapsed_seconds,
              pause_count = EXCLUDED.pause_count,
              distraction_ratio = EXCLUDED.distraction_ratio,
              answer_start_delay_seconds = EXCLUDED.answer_start_delay_seconds,
              revision_count = EXCLUDED.revision_count,
              behaviour_label = EXCLUDED.behaviour_label,
              time_modifier = EXCLUDED.time_modifier
            RETURNING *
            """,
            answer_id, user["id"], answer["question_id"], question["session_id"],
            metrics["active_time_seconds"], metrics["total_elapsed_seconds"],
            metrics["pause_count"], metrics["distraction_ratio"],
            metrics["answer_start_delay_seconds"], metrics["revision_count"],
            metrics["behaviour_label"], metrics["time_modifier"],
        )
    return BehaviourResponse(**dict(row))
