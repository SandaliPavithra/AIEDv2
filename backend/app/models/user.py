import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    role: str
    created_at: datetime
    last_active: datetime | None = None


class ConsentRequest(BaseModel):
    consent_type: str
    policy_version: str
    section_reference: str
    consent_method: str
    banner_dismissed: bool = False


class ConsentResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    consent_type: str
    policy_version: str
    section_reference: str
    consented_at: datetime
    consent_method: str
    banner_dismissed: bool
