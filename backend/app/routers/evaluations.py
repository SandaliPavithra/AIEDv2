import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import CLAUDE_EVALUATION_MODEL, EVALUATION_CONFIG
from app.models.evaluation import EvaluationResponse
from app.services.evaluation import evaluate_answer
from app.services.hallucination import check_hallucination
from app.services.scoring import compute_scores
from app.supabase_rest import rest_get_one, rest_post_one

router = APIRouter()


@router.post("/{answer_id}", response_model=EvaluationResponse)
async def run_evaluation(
    answer_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    answer = await rest_get_one(
        "answers_decrypted",
        params={"id": f"eq.{answer_id}", "user_id": f"eq.{user['id']}"},
    )
    if not answer:
        raise HTTPException(status_code=404, detail="Answer not found")

    question = await rest_get_one("questions", params={"id": f"eq.{answer['question_id']}"})
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    chunk = await rest_get_one(
        "document_chunks",
        params={"id": f"eq.{question['chunk_id']}", "select": "content"},
    )
    behaviour = await rest_get_one(
        "answer_behaviour",
        params={"answer_id": f"eq.{answer_id}", "select": "time_modifier"},
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

    # Plaintext in — the evaluations_decrypted view's INSTEAD OF INSERT trigger
    # encrypts concepts_covered/concepts_missed/feedback_text/hallucination_note.
    row = await rest_post_one(
        "evaluations_decrypted",
        json={
            "answer_id": str(answer_id),
            "question_id": question["id"],
            "session_id": question["session_id"],
            "user_id": str(user["id"]),
            "factual_correctness_score": scores["factual_correctness_score"],
            "structure_score": scores["structure_score"],
            "accuracy_score": derived["accuracy_score"],
            "precision_score": scores["precision_score"],
            "recall_score": scores["recall_score"],
            "wording_score": scores["wording_score"],
            "raw_score": derived["raw_score"],
            "time_modifier": time_modifier,
            "final_score": derived["final_score"],
            "concepts_covered": scores.get("concepts_covered", []),
            "concepts_missed": scores.get("concepts_missed", []),
            "feedback_text": scores["feedback_text"],
            "hallucination_flag": hallucinated,
            "hallucination_note": hall_note,
            "evaluator_model": CLAUDE_EVALUATION_MODEL,
            "evaluation_temperature": EVALUATION_CONFIG["temperature"],
            "evaluation_top_p": EVALUATION_CONFIG["top_p"],
            "checker_model": "grok-2-latest",
        },
    )
    return EvaluationResponse(**row)


@router.get("/{answer_id}", response_model=EvaluationResponse)
async def get_evaluation(
    answer_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    row = await rest_get_one(
        "evaluations_decrypted",
        params={"answer_id": f"eq.{answer_id}", "user_id": f"eq.{user['id']}"},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    return EvaluationResponse(**row)
