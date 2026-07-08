import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_admin
from app.models.progress import TopicResponse
from app.supabase_rest import rest_delete, rest_get, rest_get_one, rest_post_one

router = APIRouter()

_TOPIC_FIELDS = "id,name,slug,parent_id,level,description"


class CreateTopicRequest(BaseModel):
    name: str
    parent_id: uuid.UUID | None = None
    description: str = ""


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


@router.get("/", response_model=list[TopicResponse])
async def list_topics(user: Annotated[dict, Depends(get_current_user)]):
    rows = await rest_get("topics", params={"select": _TOPIC_FIELDS, "order": "level.asc,name.asc"})
    return [TopicResponse(**r) for r in rows]


@router.get("/{topic_id}", response_model=TopicResponse)
async def get_topic(
    topic_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    row = await rest_get_one("topics", params={"id": f"eq.{topic_id}", "select": _TOPIC_FIELDS})
    if not row:
        raise HTTPException(status_code=404, detail="Topic not found")
    return TopicResponse(**row)


@router.post("/", response_model=TopicResponse)
async def create_topic(
    req: CreateTopicRequest,
    admin: Annotated[dict, Depends(require_admin)],
):
    """Admin-only: create a topic node in the taxonomy."""
    slug = _slugify(req.name)
    level = 0

    if req.parent_id:
        parent = await rest_get_one("topics", params={"id": f"eq.{req.parent_id}", "select": "level"})
        if not parent:
            raise HTTPException(status_code=404, detail="Parent topic not found")
        level = parent["level"] + 1

    existing = await rest_get_one("topics", params={"slug": f"eq.{slug}", "select": "id"})
    if existing:
        slug = f"{slug}-{str(uuid.uuid4())[:4]}"

    row = await rest_post_one(
        "topics",
        json={
            "name": req.name,
            "slug": slug,
            "parent_id": str(req.parent_id) if req.parent_id else None,
            "level": level,
            "description": req.description,
        },
        params={"select": _TOPIC_FIELDS},
    )
    return TopicResponse(**row)


@router.delete("/{topic_id}", status_code=204)
async def delete_topic(
    topic_id: uuid.UUID,
    admin: Annotated[dict, Depends(require_admin)],
):
    """Admin-only: delete a leaf topic (no children, no linked documents)."""
    has_children = await rest_get_one("topics", params={"parent_id": f"eq.{topic_id}", "select": "id"})
    if has_children:
        raise HTTPException(status_code=409, detail="Cannot delete topic with children")

    has_docs = await rest_get_one("documents", params={"topic_id": f"eq.{topic_id}", "select": "id"})
    if has_docs:
        raise HTTPException(status_code=409, detail="Cannot delete topic linked to documents")

    deleted = await rest_delete("topics", params={"id": f"eq.{topic_id}"})
    if not deleted:
        raise HTTPException(status_code=404, detail="Topic not found")
