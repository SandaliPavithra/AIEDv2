import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class ProgressSnapshotResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    topic_id: uuid.UUID
    snapshot_date: date
    avg_factual_correctness: Decimal | None = None
    avg_structure: Decimal | None = None
    avg_accuracy: Decimal | None = None
    avg_precision: Decimal | None = None
    avg_recall: Decimal | None = None
    avg_wording: Decimal | None = None
    avg_raw_score: Decimal | None = None
    avg_final_score: Decimal | None = None
    avg_time_modifier: Decimal | None = None
    avg_conciseness: Decimal | None = None
    avg_copy_similarity: Decimal | None = None
    dominant_behaviour: str | None = None
    questions_attempted: int
    sessions_completed: int
    goal_proximity: Decimal | None = None


class RecommendationResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    session_id: uuid.UUID
    chunk_id: uuid.UUID
    topic_id: uuid.UUID
    reason: str
    priority: int
    viewed: bool
    viewed_at: date | None = None
    created_at: date


class TopicResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    parent_id: uuid.UUID | None = None
    level: int
    description: str | None = None


class GoalResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    goal_text: str
    goal_structured: dict
    topic_id: uuid.UUID | None = None
    status: str


class ChatMessageRequest(BaseModel):
    content: str


class ChatChartSeries(BaseModel):
    name: str
    values: list[float]


class ChatChart(BaseModel):
    kind: str
    title: str
    x_labels: list[str]
    series: list[ChatChartSeries]


class ChatMessageResponse(BaseModel):
    role: str
    content: str
    chart: ChatChart | None = None
