import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import get_pool
from app.models.progress import RecommendationResponse

router = APIRouter()


@router.get("/", response_model=list[RecommendationResponse])
async def list_recommendations(user: Annotated[dict, Depends(get_current_user)]):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM recommendations
            WHERE user_id = $1
            ORDER BY priority ASC, created_at DESC
            """,
            user["id"],
        )
    return [RecommendationResponse(**dict(r)) for r in rows]


@router.post("/{rec_id}/viewed")
async def mark_viewed(
    rec_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE recommendations SET viewed = true, viewed_at = now()
            WHERE id = $1 AND user_id = $2
            RETURNING id
            """,
            rec_id, user["id"],
        )
    if not row:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return {"detail": "Marked as viewed"}
