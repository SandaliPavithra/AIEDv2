import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    topic_ids: list[uuid.UUID] = Field(min_length=1)
    difficulty: str
    total_questions: int = 5
    question_type: str = "mixed"


class SessionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    topic_ids: list[uuid.UUID]
    difficulty: str
    total_questions: int
    status: str
    overall_score: Decimal | None = None
    generation_temperature: Decimal | None = None
    generation_top_p: Decimal | None = None
    retrieval_top_k: int | None = None
    started_at: datetime
    completed_at: datetime | None = None
