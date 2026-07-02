import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user, require_admin
from app.database import get_pool
from app.models.progress import TopicResponse

router = APIRouter()


class CreateTopicRequest(BaseModel):
    name: str
    parent_id: uuid.UUID | None = None
    description: str = ""


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


@router.get("/", response_model=list[TopicResponse])
async def list_topics(user: Annotated[dict, Depends(get_current_user)]):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name, slug, parent_id, level, description FROM topics ORDER BY level, name"
        )
    return [TopicResponse(**dict(r)) for r in rows]


@router.get("/{topic_id}", response_model=TopicResponse)
async def get_topic(
    topic_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, slug, parent_id, level, description FROM topics WHERE id = $1",
            topic_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Topic not found")
    return TopicResponse(**dict(row))


@router.post("/", response_model=TopicResponse)
async def create_topic(
    req: CreateTopicRequest,
    admin: Annotated[dict, Depends(require_admin)],
):
    """Admin-only: create a topic node in the taxonomy."""
    pool = await get_pool()

    slug = _slugify(req.name)
    level = 0

    async with pool.acquire() as conn:
        # Determine level from parent
        if req.parent_id:
            parent = await conn.fetchrow(
                "SELECT level FROM topics WHERE id = $1", req.parent_id
            )
            if not parent:
                raise HTTPException(status_code=404, detail="Parent topic not found")
            level = parent["level"] + 1

        # Ensure slug is unique
        existing = await conn.fetchval("SELECT id FROM topics WHERE slug = $1", slug)
        if existing:
            slug = f"{slug}-{str(uuid.uuid4())[:4]}"

        row = await conn.fetchrow(
            """
            INSERT INTO topics (id, name, slug, parent_id, level, description)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
            RETURNING id, name, slug, parent_id, level, description
            """,
            req.name, slug, req.parent_id, level, req.description,
        )

    return TopicResponse(**dict(row))


@router.delete("/{topic_id}", status_code=204)
async def delete_topic(
    topic_id: uuid.UUID,
    admin: Annotated[dict, Depends(require_admin)],
):
    """Admin-only: delete a leaf topic (no children, no linked documents)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        has_children = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM topics WHERE parent_id = $1)", topic_id
        )
        if has_children:
            raise HTTPException(status_code=409, detail="Cannot delete topic with children")

        has_docs = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE topic_id = $1)", topic_id
        )
        if has_docs:
            raise HTTPException(status_code=409, detail="Cannot delete topic linked to documents")

        deleted = await conn.fetchval(
            "DELETE FROM topics WHERE id = $1 RETURNING id", topic_id
        )
    if not deleted:
        raise HTTPException(status_code=404, detail="Topic not found")
