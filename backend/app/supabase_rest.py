"""Thin PostgREST client — replaces asyncpg/DATABASE_URL for all DB access.

All base-table/decrypted-view access goes through the `aied` schema profile.
Encrypted-column writes rely on the INSTEAD OF INSERT/UPDATE triggers defined
in decrypted_view_writes_and_rpc.sql; this module has no knowledge of
encryption at all, it just sends plaintext JSON to the *_decrypted views.
"""

import httpx
from fastapi import HTTPException, status

from app.config import settings

_HEADERS = {
    "apikey": settings.SUPABASE_SERVICE_KEY,
    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
    "Content-Type": "application/json",
    "Accept-Profile": "aied",
    "Content-Profile": "aied",
}


def _rest_base_url() -> str:
    # SUPABASE_URL may already include /rest/v1/ — normalize to the project root first.
    base = settings.SUPABASE_URL.rstrip("/").replace("/rest/v1", "").rstrip("/")
    return f"{base}/rest/v1"


async def _request(method: str, path: str, **kwargs) -> httpx.Response:
    headers = {**_HEADERS, **kwargs.pop("headers", {})}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.request(method, f"{_rest_base_url()}/{path}", headers=headers, **kwargs)
    except httpx.HTTPError as exc:
        # Raised as HTTPException (not left as a raw httpx exception) so it flows
        # through Starlette's ExceptionMiddleware, which CORSMiddleware wraps — a
        # raw unhandled exception instead reaches ServerErrorMiddleware, which sits
        # outside CORSMiddleware, and the browser reports a CORS error instead of
        # the real 503. Same fix as the earlier asyncpg get_pool() issue.
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Database unavailable: {exc}") from exc

    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except ValueError:
            detail = resp.text
        raise HTTPException(status_code=resp.status_code if resp.status_code < 500 else 502, detail=detail)
    return resp


async def rest_get(path: str, params: dict | None = None) -> list[dict]:
    resp = await _request("GET", path, params=params)
    return resp.json()


async def rest_get_one(path: str, params: dict | None = None) -> dict | None:
    rows = await rest_get(path, params)
    return rows[0] if rows else None


async def rest_post(path: str, json: dict | list[dict], params: dict | None = None) -> list[dict]:
    resp = await _request("POST", path, json=json, params=params, headers={"Prefer": "return=representation"})
    return resp.json()


async def rest_post_one(path: str, json: dict, params: dict | None = None) -> dict:
    rows = await rest_post(path, json, params)
    return rows[0]


async def rest_patch(path: str, params: dict, json: dict) -> list[dict]:
    resp = await _request("PATCH", path, params=params, json=json, headers={"Prefer": "return=representation"})
    return resp.json()


async def rest_upsert(path: str, json: dict | list[dict], on_conflict: str) -> list[dict]:
    """POST with Prefer: resolution=merge-duplicates — used for base-table upserts
    that don't go through a decrypted view (e.g. user_documents)."""
    resp = await _request(
        "POST", path, json=json, params={"on_conflict": on_conflict},
        headers={"Prefer": "resolution=merge-duplicates,return=representation"},
    )
    return resp.json()


async def rest_delete(path: str, params: dict) -> list[dict]:
    resp = await _request("DELETE", path, params=params, headers={"Prefer": "return=representation"})
    return resp.json()


async def rest_rpc(function_name: str, args: dict) -> list[dict] | dict | None:
    resp = await _request("POST", f"rpc/{function_name}", json=args)
    return resp.json() if resp.content else None
