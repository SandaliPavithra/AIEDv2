import uuid
from datetime import datetime

from pydantic import BaseModel


class DocumentResponse(BaseModel):
    id: uuid.UUID
    title: str
    author: str
    document_type: str
    difficulty: str
    total_pages: int | None = None
    total_chunks: int | None = None
    ingestion_status: str
    uploaded_at: datetime
    topic_id: uuid.UUID | None = None


class DocumentWithAccess(DocumentResponse):
    last_accessed_at: datetime | None = None
    access_count: int = 0
    downloaded: bool = False
    download_count: int = 0
    last_downloaded_at: datetime | None = None


class UploadDocumentRequest(BaseModel):
    title: str
    author: str
    document_type: str
    difficulty: str
    topic_id: uuid.UUID | None = None


class SignedUrlResponse(BaseModel):
    url: str
    expires_at: datetime
