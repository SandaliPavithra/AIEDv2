import uuid
from datetime import datetime

from pydantic import BaseModel


class GenerateReportRequest(BaseModel):
    question: str


class DiagramSeries(BaseModel):
    name: str
    values: list[float]


class Diagram(BaseModel):
    kind: str
    title: str
    x_labels: list[str]
    series: list[DiagramSeries]


class DeepEvaluationReportSummary(BaseModel):
    """Light shape for the sidebar list — no analysis/justification/predictions/diagrams."""
    id: uuid.UUID
    question_text: str
    summary: str
    created_at: datetime


class DeepEvaluationReportResponse(BaseModel):
    id: uuid.UUID
    question_text: str
    summary: str
    analysis: str
    justification: str
    predictions: str
    diagrams: list[Diagram]
    created_at: datetime
