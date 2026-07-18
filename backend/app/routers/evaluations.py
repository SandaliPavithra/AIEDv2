import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import CLAUDE_EVALUATION_MODEL, EVALUATION_CONFIG
from app.models.evaluation import EvaluationResponse
from app.services.evaluation import evaluate_answer, explain_mcq_answer
from app.services.hallucination import check_hallucination
from app.services.scoring import compute_scores
from app.services.text_metrics import compute_conciseness_score, compute_copy_similarity_score
from app.supabase_rest import rest_get_one, rest_post_one

router = APIRouter()


async def _score_mcq(question: dict, answer_text: str, source_chunk: str) -> dict:
    """MCQ correctness is a deterministic lookup — there's nothing for an LLM
    judge to weigh in on, so this skips evaluate_answer()'s free-text scoring
    entirely rather than spending an AI call asking a model to grade a fact it
    can just look up. All five score dimensions collapse to a single
    correct/incorrect signal since precision/recall/wording etc. don't mean
    anything distinct for a single selected option. The *explanation* of why
    each option is right/wrong is still worth an AI call (explain_mcq_answer)
    — that's a genuine language task, unlike the correctness fact itself."""
    options = question["options"]
    if isinstance(options, str):
        options = json.loads(options)
    correct_index = question["correct_index"]
    correct_text = options[correct_index] if options and correct_index is not None else ""
    is_correct = answer_text.strip() == correct_text.strip()
    dim_score = 100.0 if is_correct else 0.0

    feedback = await explain_mcq_answer(
        question_text=question["question_text"],
        options=options,
        correct_index=correct_index,
        selected_text=answer_text,
        is_correct=is_correct,
        source_chunk=source_chunk,
    )
    return {
        "factual_correctness_score": dim_score,
        "structure_score": dim_score,
        "precision_score": dim_score,
        "recall_score": dim_score,
        "wording_score": dim_score,
        "feedback_text": feedback,
        "concepts_covered": [],
        "concepts_missed": [],
    }


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

    if question["question_type"] == "mcq":
        scores = await _score_mcq(question, answer["answer_text"], source_chunk)
        hallucinated, hall_note = False, None
        # Correctness itself is rule-based (see _score_mcq); evaluator_model
        # reflects that the *explanation* text did go through Claude.
        evaluator_model, evaluation_temperature, evaluation_top_p = CLAUDE_EVALUATION_MODEL, 0, 0
        checker_model = "none"
    else:
        expected_concepts = question["expected_concepts"]
        if isinstance(expected_concepts, str):
            expected_concepts = json.loads(expected_concepts)

        scores = await evaluate_answer(
            question_text=question["question_text"],
            expected_concepts=expected_concepts,
            answer_text=answer["answer_text"],
            source_chunk=source_chunk,
        )
        hallucinated, hall_note = await check_hallucination(
            evaluation_text=scores["feedback_text"],
            source_chunk=source_chunk,
        )
        evaluator_model = CLAUDE_EVALUATION_MODEL
        evaluation_temperature, evaluation_top_p = EVALUATION_CONFIG["temperature"], EVALUATION_CONFIG["top_p"]
        checker_model = "grok-2-latest"

    derived = compute_scores(
        factual_correctness=scores["factual_correctness_score"],
        structure=scores["structure_score"],
        precision=scores["precision_score"],
        recall=scores["recall_score"],
        wording=scores["wording_score"],
        time_modifier=time_modifier,
    )

    # Deterministic, no additional AI call — None for MCQ (see text_metrics.py).
    conciseness_score = compute_conciseness_score(
        answer_text=answer["answer_text"],
        question_type=question["question_type"],
        difficulty=question["difficulty"],
    )
    copy_similarity_score = compute_copy_similarity_score(
        answer_text=answer["answer_text"],
        source_chunk=source_chunk,
        question_type=question["question_type"],
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
            "conciseness_score": conciseness_score,
            "copy_similarity_score": copy_similarity_score,
            "concepts_covered": scores.get("concepts_covered", []),
            "concepts_missed": scores.get("concepts_missed", []),
            "feedback_text": scores["feedback_text"],
            "hallucination_flag": hallucinated,
            "hallucination_note": hall_note,
            "evaluator_model": evaluator_model,
            "evaluation_temperature": evaluation_temperature,
            "evaluation_top_p": evaluation_top_p,
            "checker_model": checker_model,
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
