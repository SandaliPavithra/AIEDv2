from datetime import datetime, timedelta, timezone
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from app.config import settings
from app.database import get_pool

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

_entra_jwks: dict | None = None


async def _get_entra_jwks() -> dict:
    global _entra_jwks
    if _entra_jwks is None:
        jwks_url = (
            f"https://login.microsoftonline.com/{settings.ENTRA_TENANT_ID}"
            "/discovery/v2.0/keys"
        )
        async with httpx.AsyncClient() as client:
            resp = await client.get(jwks_url)
            resp.raise_for_status()
            _entra_jwks = resp.json()
    return _entra_jwks


def create_access_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode_local_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> dict:
    payload = _decode_local_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, display_name, role, is_active FROM users WHERE id = $1",
            user_id,
        )

    if not row or not row["is_active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # update last_active
    async with (await get_pool()).acquire() as conn:
        await conn.execute(
            "UPDATE users SET last_active = now() WHERE id = $1", user_id
        )

    return dict(row)


async def require_admin(user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user
