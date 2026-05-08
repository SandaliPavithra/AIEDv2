import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Annotated

import msal
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from app.auth import create_access_token, get_current_user
from app.config import settings
from app.database import get_pool
from app.models.user import UserResponse

router = APIRouter()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _generate_display_name() -> str:
    suffix = secrets.token_hex(4)
    return f"user_{suffix}"


@router.post("/callback")
async def entra_callback(request: Request):
    """Exchange Entra ID authorization code for a local JWT."""
    body = await request.json()
    code = body.get("code")
    redirect_uri = body.get("redirect_uri")
    if not code or not redirect_uri:
        raise HTTPException(status_code=400, detail="Missing code or redirect_uri")

    app_msal = msal.ConfidentialClientApplication(
        settings.ENTRA_CLIENT_ID,
        authority=settings.ENTRA_AUTHORITY,
        client_credential=settings.ENTRA_CLIENT_SECRET,
    )
    result = app_msal.acquire_token_by_authorization_code(
        code, scopes=["openid", "profile", "email"], redirect_uri=redirect_uri
    )
    if "error" in result:
        raise HTTPException(status_code=401, detail=result.get("error_description"))

    id_token_claims = result.get("id_token_claims", {})
    entra_id = id_token_claims.get("oid") or id_token_claims.get("sub")
    email = id_token_claims.get("preferred_username") or id_token_claims.get("email", "")
    email_hash = _sha256(email.lower())

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, role, is_active FROM users WHERE entra_id = $1", entra_id
        )
        if row is None:
            user_id = str(uuid.uuid4())
            display_name = _generate_display_name()
            await conn.execute(
                """
                INSERT INTO users (id, display_name, email_hash, password_hash, entra_id, role, created_at, is_active)
                VALUES ($1, $2, $3, '', $4, 'student', now(), true)
                """,
                user_id, display_name, email_hash, entra_id,
            )
            role = "student"
        else:
            if not row["is_active"]:
                raise HTTPException(status_code=403, detail="Account disabled")
            user_id = str(row["id"])
            role = row["role"]

    token = create_access_token(user_id, role)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
async def get_me(user: Annotated[dict, Depends(get_current_user)]):
    return UserResponse(**user)


@router.post("/logout")
async def logout(user: Annotated[dict, Depends(get_current_user)]):
    return {"detail": "Logged out"}
