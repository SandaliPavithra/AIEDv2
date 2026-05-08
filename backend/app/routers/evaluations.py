import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import EVALUATION_CONFIG, SONNET_MODEL
from app.database import get_pool
from app.models.evaluation import EvaluationResponse
from app.services.evaluation import evaluate_answer
from app.services.hallucination import check_hallucination
from app.services.scoring import compute_scores

router = APIRouter()


@router.post("/{answer_id}", response_model=EvaluationResponse)
async def run_evaluation(
    answer_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        answer = await conn.fetchrow(
            "SELECT * FROM answers WHERE id = $1 AND user_id = $2",
            answer_id, user["id"],
        )
        if not answer:
            raise HTTPException(status_code=404, detail="Answer not found")

        question = await conn.fetchrow(
            "SELECT * FROM questions WHERE id = $1", answer["question_id"]
        )
        if not question:
            raise HTTPException(status_code=404, detail="Question not found")

        chunk = await conn.fetchrow(
            "SELECT content FROM document_chunks WHERE id = $1", question["chunk_id"]
        )

        behaviour = await conn.fetchrow(
            "SELECT time_modifier FROM answer_behaviour WHERE answer_id = $1", answer_id
        )

    time_modifier = float(behaviour["time_modifier"]) if behaviour else 1.0
    source_chunk = chunk["content"] if chunk else ""

    expected_concepts = question["expected_concepts"]
    if isinstance(expected_concepts, str):
        expected_concepts = json.loads(expected_concepts)

    scores = await evaluate_answer(
        question_text=question["question_text"],
        expected_concepts=expected_concepts,
        answer_text=answer["answer_text"],
        source_chunk=source_chunk,
    )

    derived = compute_scores(
        factual_correctness=scores["factual_correctness_score"],
        structure=scores["structure_score"],
        precision=scores["precision_score"],
        recall=scores["recall_score"],
        wording=scores["wording_score"],
        time_modifier=time_modifier,
    )

    hallucinated, hall_note = await check_hallucination(
        evaluation_text=scores["feedback_text"],
        source_chunk=source_chunk,
    )

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO evaluations
              (id, answer_id, question_id, session_id, user_id,
               factual_correctness_score, structure_score, accuracy_score,
               precision_score, recall_score, wording_score,
               raw_score, time_modifier, final_score,
               concepts_covered, concepts_missed, feedback_text,
               hallucination_flag, hallucination_note,
               evaluator_model, evaluation_temperature, evaluation_top_p,
               checker_model, created_at)
            VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,now())
            RETURNING *
            """,
            answer_id, question["id"], question["session_id"], user["id"],
            scores["factual_correctness_score"], scores["structure_score"],
            derived["accuracy_score"], scores["precision_score"], scores["recall_score"],
            scores["wording_score"], derived["raw_score"], time_modifier,
            derived["final_score"],
            json.dumps(scores.get("concepts_covered", [])),
            json.dumps(scores.get("concepts_missed", [])),
            scores["feedback_text"],
            hallucinated, hall_note,
            SONNET_MODEL, EVALUATION_CONFIG["temperature"], EVALUATION_CONFIG["top_p"],
            "grok-2-latest",
        )

    result = dict(row)
    for key in ("concepts_covered", "concepts_missed"):
        if isinstance(result[key], str):
            result[key] = json.loads(result[key])

    return EvaluationResponse(**result)


@router.get("/{answer_id}", response_model=EvaluationResponse)
async def get_evaluation(
    answer_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM evaluations WHERE answer_id = $1 AND user_id = $2",
            answer_id, user["id"],
        )
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    result = dict(row)
    for key in ("concepts_covered", "concepts_missed"):
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return EvaluationResponse(**result)
