import uuid
from datetime import datetime

from pydantic import BaseModel


class SubmitAnswerRequest(BaseModel):
    question_id: uuid.UUID
    session_id: uuid.UUID
    answer_text: str


class BehaviourEventRequest(BaseModel):
    event_type: str
    event_at: datetime


class SubmitEventsRequest(BaseModel):
    events: list[BehaviourEventRequest]


class AnswerResponse(BaseModel):
    id: uuid.UUID
    question_id: uuid.UUID
    user_id: uuid.UUID
    session_id: uuid.UUID
    answer_text: str
    submitted_at: datetime


class BehaviourResponse(BaseModel):
    id: uuid.UUID
    answer_id: uuid.UUID
    active_time_seconds: int
    total_elapsed_seconds: int
    pause_count: int
    distraction_ratio: float
    answer_start_delay_seconds: int
    revision_count: int
    behaviour_label: str
    time_modifier: float
