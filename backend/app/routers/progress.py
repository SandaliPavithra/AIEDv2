import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import get_pool
from app.models.progress import ProgressSnapshotResponse

router = APIRouter()


@router.get("/", response_model=list[ProgressSnapshotResponse])
async def list_progress(user: Annotated[dict, Depends(get_current_user)]):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM progress_snapshots
            WHERE user_id = $1
            ORDER BY snapshot_date DESC, topic_id
            """,
            user["id"],
        )
    return [ProgressSnapshotResponse(**dict(r)) for r in rows]


@router.get("/{topic_id}", response_model=list[ProgressSnapshotResponse])
async def progress_by_topic(
    topic_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM progress_snapshots
            WHERE user_id = $1 AND topic_id = $2
            ORDER BY snapshot_date DESC
            """,
            user["id"], topic_id,
        )
    return [ProgressSnapshotResponse(**dict(r)) for r in rows]
