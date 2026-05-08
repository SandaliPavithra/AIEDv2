import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class QuestionResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    chunk_id: uuid.UUID
    topic_id: uuid.UUID | None = None
    question_text: str
    question_type: str
    difficulty: str
    expected_concepts: list[str]
    expected_time_seconds: int
    citation_book: str | None = None
    citation_author: str | None = None
    citation_chapter: str | None = None
    citation_page_start: int | None = None
    citation_page_end: int | None = None
    model_used: str
    created_at: datetime
