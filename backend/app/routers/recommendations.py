import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.models.progress import RecommendationResponse
from app.supabase_rest import rest_get, rest_patch

router = APIRouter()


@router.get("/", response_model=list[RecommendationResponse])
async def list_recommendations(user: Annotated[dict, Depends(get_current_user)]):
    rows = await rest_get(
        "recommendations_decrypted",
        params={"user_id": f"eq.{user['id']}", "order": "priority.asc,created_at.desc"},
    )
    return [RecommendationResponse(**r) for r in rows]


@router.post("/{rec_id}/viewed")
async def mark_viewed(
    rec_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    # Goes through the decrypted view's INSTEAD OF UPDATE trigger, which only
    # ever touches viewed/viewed_at — reason is immutable after creation.
    rows = await rest_patch(
        "recommendations_decrypted",
        params={"id": f"eq.{rec_id}", "user_id": f"eq.{user['id']}"},
        json={"viewed": True, "viewed_at": datetime.now(timezone.utc).isoformat()},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return {"detail": "Marked as viewed"}
