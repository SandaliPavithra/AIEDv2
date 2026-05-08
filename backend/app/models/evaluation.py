import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class EvaluationResponse(BaseModel):
    id: uuid.UUID
    answer_id: uuid.UUID
    question_id: uuid.UUID
    session_id: uuid.UUID
    user_id: uuid.UUID
    factual_correctness_score: Decimal
    structure_score: Decimal
    accuracy_score: Decimal
    precision_score: Decimal
    recall_score: Decimal
    wording_score: Decimal
    raw_score: Decimal
    time_modifier: Decimal
    final_score: Decimal
    concepts_covered: list[str]
    concepts_missed: list[str]
    feedback_text: str
    hallucination_flag: bool
    hallucination_note: str | None = None
    evaluator_model: str
    evaluation_temperature: Decimal
    evaluation_top_p: Decimal
    checker_model: str
    created_at: datetime
