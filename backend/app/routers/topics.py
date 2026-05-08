import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import get_pool
from app.models.progress import TopicResponse

router = APIRouter()


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
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Topic not found")
    return TopicResponse(**dict(row))
