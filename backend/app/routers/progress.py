import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.models.progress import ProgressSnapshotResponse
from app.supabase_rest import rest_get

router = APIRouter()


@router.get("/", response_model=list[ProgressSnapshotResponse])
async def list_progress(user: Annotated[dict, Depends(get_current_user)]):
    rows = await rest_get(
        "progress_snapshots_decrypted",
        params={"user_id": f"eq.{user['id']}", "order": "snapshot_date.desc,topic_id.asc"},
    )
    return [ProgressSnapshotResponse(**r) for r in rows]


@router.get("/{topic_id}", response_model=list[ProgressSnapshotResponse])
async def progress_by_topic(
    topic_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    rows = await rest_get(
        "progress_snapshots_decrypted",
        params={"user_id": f"eq.{user['id']}", "topic_id": f"eq.{topic_id}", "order": "snapshot_date.desc"},
    )
    return [ProgressSnapshotResponse(**r) for r in rows]
