import hashlib
import secrets
import uuid
from typing import Annotated

import httpx
import msal
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from app.auth import create_access_token, get_current_user
from app.config import settings
from app.models.user import RegisterRequest, UserResponse
from app.supabase_rest import rest_get_one, rest_post_one

router = APIRouter()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _generate_display_name() -> str:
    suffix = secrets.token_hex(4)
    return f"user_{suffix}"


def _supabase_base_url() -> str:
    # SUPABASE_URL may include /rest/v1/ — strip it to get the project base URL
    return settings.SUPABASE_URL.rstrip("/").replace("/rest/v1", "").rstrip("/")


async def _create_app_user(entra_id: str, email: str, display_name: str | None = None) -> dict:
    email_hash = _sha256(email.lower())
    return await rest_post_one(
        "users",
        json={
            "id": str(uuid.uuid4()),
            "display_name": display_name or _generate_display_name(),
            "email_hash": email_hash,
            "password_hash": "",
            "entra_id": entra_id,
            "role": "student",
            "is_active": True,
        },
    )


@router.post("/register")
async def register(req: RegisterRequest):
    """Create a Supabase Auth account, then the corresponding app user row, and return a local JWT."""
    signup_url = f"{_supabase_base_url()}/auth/v1/signup"

    async with httpx.AsyncClient() as client:
        signup_resp = await client.post(
            signup_url,
            json={"email": req.email, "password": req.password},
            headers={"apikey": settings.SUPABASE_KEY, "Content-Type": "application/json"},
        )
    if signup_resp.status_code not in (200, 201):
        body = signup_resp.json()
        detail = body.get("error_description") or body.get("msg") or "Registration failed"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    supabase_body = signup_resp.json()
    supabase_user = supabase_body.get("user") or supabase_body
    supabase_uid = supabase_user["id"]

    user = await _create_app_user(supabase_uid, req.email, req.display_name)
    token = create_access_token(user["id"], "student")
    return {"access_token": token, "token_type": "bearer"}


@router.post("/token")
async def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    """Sign in with email + password via Supabase Auth, return a local JWT."""
    auth_url = f"{_supabase_base_url()}/auth/v1/token?grant_type=password"

    async with httpx.AsyncClient() as client:
        auth_resp = await client.post(
            auth_url,
            json={"email": form.username, "password": form.password},
            headers={"apikey": settings.SUPABASE_KEY, "Content-Type": "application/json"},
        )
    if auth_resp.status_code != 200:
        body = auth_resp.json()
        detail = body.get("error_description") or body.get("msg") or "Invalid credentials"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

    supabase_user = auth_resp.json()["user"]
    supabase_uid = supabase_user["id"]
    email = supabase_user.get("email", "")

    row = await rest_get_one(
        "users",
        params={"entra_id": f"eq.{supabase_uid}", "select": "id,role,is_active"},
    )

    if not row:
        new_user = await _create_app_user(supabase_uid, email)
        user_id, role = new_user["id"], "student"
    else:
        if not row["is_active"]:
            raise HTTPException(status_code=403, detail="Account disabled")
        user_id, role = str(row["id"]), row["role"]

    token = create_access_token(user_id, role)
    return {"access_token": token, "token_type": "bearer"}


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

    row = await rest_get_one(
        "users",
        params={"entra_id": f"eq.{entra_id}", "select": "id,role,is_active"},
    )

    if row is None:
        new_user = await _create_app_user(entra_id, email)
        user_id, role = new_user["id"], "student"
    else:
        if not row["is_active"]:
            raise HTTPException(status_code=403, detail="Account disabled")
        user_id, role = str(row["id"]), row["role"]

    token = create_access_token(user_id, role)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
async def get_me(user: Annotated[dict, Depends(get_current_user)]):
    return UserResponse(**user)


@router.post("/logout")
async def logout(user: Annotated[dict, Depends(get_current_user)]):
    return {"detail": "Logged out"}
