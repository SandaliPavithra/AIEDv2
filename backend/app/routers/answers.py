import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.models.answer import (
    AnswerResponse,
    BehaviourResponse,
    SubmitAnswerRequest,
    SubmitEventsRequest,
)
from app.services.behaviour import compute_behaviour
from app.supabase_rest import rest_get_one, rest_post, rest_post_one

router = APIRouter()


@router.post("/", response_model=AnswerResponse)
async def submit_answer(
    req: SubmitAnswerRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    # Plaintext in, plaintext out — the answers_decrypted view's INSTEAD OF
    # INSERT trigger encrypts answer_text before it ever reaches the base table.
    row = await rest_post_one(
        "answers_decrypted",
        json={
            "question_id": str(req.question_id),
            "user_id": str(user["id"]),
            "session_id": str(req.session_id),
            "answer_text": req.answer_text,
        },
    )
    return AnswerResponse(**row)


@router.post("/{answer_id}/events", response_model=BehaviourResponse)
async def submit_events(
    answer_id: uuid.UUID,
    req: SubmitEventsRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    answer = await rest_get_one(
        "answers",
        params={"id": f"eq.{answer_id}", "user_id": f"eq.{user['id']}", "select": "question_id"},
    )
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")

    question = await rest_get_one(
        "questions",
        params={"id": f"eq.{answer['question_id']}", "select": "expected_time_seconds,session_id"},
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    if req.events:
        await rest_post(
            "question_events",
            json=[
                {
                    "answer_id": str(answer_id),
                    "user_id": str(user["id"]),
                    "question_id": answer["question_id"],
                    "session_id": question["session_id"],
                    "event_type": ev.event_type,
                    "event_at": ev.event_at.isoformat(),
                    "expires_at": (ev.event_at + timedelta(days=30)).isoformat(),
                }
                for ev in req.events
            ],
        )

    events_list = [{"event_type": e.event_type, "event_at": e.event_at} for e in req.events]
    metrics = compute_behaviour(events_list, question["expected_time_seconds"])

    # answer_behaviour_decrypted's trigger upserts on answer_id internally
    # (a view can't take an ON CONFLICT clause directly) and encrypts behaviour_label.
    row = await rest_post_one(
        "answer_behaviour_decrypted",
        json={
            "answer_id": str(answer_id),
            "user_id": str(user["id"]),
            "question_id": answer["question_id"],
            "session_id": question["session_id"],
            "active_time_seconds": metrics["active_time_seconds"],
            "total_elapsed_seconds": metrics["total_elapsed_seconds"],
            "pause_count": metrics["pause_count"],
            "distraction_ratio": metrics["distraction_ratio"],
            "answer_start_delay_seconds": metrics["answer_start_delay_seconds"],
            "revision_count": metrics["revision_count"],
            "behaviour_label": metrics["behaviour_label"],
            "time_modifier": metrics["time_modifier"],
            "mouse_activity_count": metrics["mouse_activity_count"],
            "option_hover_count": metrics["option_hover_count"],
        },
    )
    return BehaviourResponse(**row)
