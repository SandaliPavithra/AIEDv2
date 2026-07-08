import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.auth import get_current_user, require_admin
from app.config import settings
from app.database import get_supabase
from app.logging_config import logger
from app.models.document import DocumentResponse, DocumentWithAccess, SignedUrlResponse
from app.services.ingestion import ingest_document
from app.supabase_rest import rest_get, rest_get_one, rest_post_one, rest_rpc

router = APIRouter()


def _upload_to_storage(storage_key: str, file_bytes: bytes) -> None:
    supabase = get_supabase()
    supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).upload(
        storage_key, file_bytes, {"content-type": "application/pdf"}
    )


def _create_signed_url(storage_key: str, expires_in: int) -> dict:
    supabase = get_supabase()
    return supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).create_signed_url(storage_key, expires_in)


@router.post("/", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    title: Annotated[str, Form()],
    author: Annotated[str, Form()],
    document_type: Annotated[str, Form()],
    difficulty: Annotated[str, Form()],
    topic_id: Annotated[str | None, Form()] = None,
    file: UploadFile = File(...),
    admin: Annotated[dict, Depends(require_admin)] = None,
):
    doc_id = uuid.uuid4()
    storage_key = f"{doc_id}/{file.filename}"

    file_bytes = await file.read()
    logger.info(
        "[documents.py] Uploading %s (%d bytes) to bucket %r as %s",
        file.filename, len(file_bytes), settings.SUPABASE_STORAGE_BUCKET, storage_key,
    )
    try:
        # supabase-py's Storage client is synchronous — off the event loop via
        # asyncio.to_thread, or a multi-second upload blocks every other
        # request on the server for its whole duration (confirmed live: this
        # was a real, repeated cause of the backend appearing to freeze).
        await asyncio.to_thread(_upload_to_storage, storage_key, file_bytes)
    except Exception as exc:
        logger.exception("[documents.py] Storage upload failed for %s", storage_key)
        raise HTTPException(
            status_code=502,
            detail=(
                f"Storage upload failed: {exc}. If this is a 'Bucket not found' error, "
                f"create a bucket named {settings.SUPABASE_STORAGE_BUCKET!r} in the Supabase "
                "dashboard under Storage."
            ),
        ) from exc
    logger.info("[documents.py] Upload to storage complete: %s", storage_key)

    tid = uuid.UUID(topic_id) if topic_id else None
    row = await rest_post_one(
        "documents",
        json={
            "id": str(doc_id),
            "title": title,
            "author": author,
            "document_type": document_type,
            "difficulty": difficulty,
            "storage_key": storage_key,
            "ingestion_status": "pending",
            "uploaded_by": str(admin["id"]),
            "topic_id": str(tid) if tid else None,
        },
    )

    background_tasks.add_task(ingest_document, doc_id, storage_key, tid, difficulty)

    return DocumentResponse(**row)


@router.get("/", response_model=list[DocumentResponse])
async def list_documents(user: Annotated[dict, Depends(get_current_user)]):
    rows = await rest_get(
        "documents",
        params={"ingestion_status": "eq.complete", "order": "uploaded_at.desc"},
    )
    return [DocumentResponse(**r) for r in rows]


@router.post("/{doc_id}/retry", response_model=DocumentResponse)
async def retry_ingestion(
    doc_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    admin: Annotated[dict, Depends(require_admin)],
):
    """Admin-only: re-run ingestion for a document that's already in storage
    (failed/pending/stuck), without re-uploading the file."""
    doc = await rest_get_one("documents", params={"id": f"eq.{doc_id}"})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # ingestion_status is only ever "processing" while a task is genuinely
    # live in this same process (the startup reconciliation in main.py resets
    # any stale leftover from a dead process before this can be reached) — so
    # this check is trustworthy, not just a stale flag. Without it, clicking
    # Retry twice in quick succession would fire two concurrent ingestion runs
    # for the same document.
    if doc["ingestion_status"] == "processing":
        raise HTTPException(status_code=409, detail="This document is already being processed.")

    background_tasks.add_task(
        ingest_document,
        doc_id,
        doc["storage_key"],
        doc["topic_id"],
        doc["difficulty"],
    )
    return DocumentResponse(**doc)


@router.get("/admin", response_model=list[DocumentResponse])
async def list_all_documents_admin(admin: Annotated[dict, Depends(require_admin)]):
    """Admin-only: every document regardless of ingestion status, for the upload dashboard."""
    rows = await rest_get("documents", params={"order": "uploaded_at.desc"})
    return [DocumentResponse(**r) for r in rows]


@router.get("/my-library", response_model=list[DocumentWithAccess])
async def my_library(user: Annotated[dict, Depends(get_current_user)]):
    access_rows = await rest_get(
        "user_documents",
        params={
            "user_id": f"eq.{user['id']}",
            "order": "last_accessed_at.desc",
            "select": "document_id,last_accessed_at,access_count,downloaded,download_count,last_downloaded_at",
        },
    )
    if not access_rows:
        return []

    doc_ids = ",".join(str(r["document_id"]) for r in access_rows)
    docs = {
        d["id"]: d
        for d in await rest_get("documents", params={"id": f"in.({doc_ids})"})
    }

    result = []
    for access in access_rows:
        doc = docs.get(access["document_id"])
        if not doc:
            continue
        result.append(DocumentWithAccess(**doc, **{k: v for k, v in access.items() if k != "document_id"}))
    return result


@router.get("/{doc_id}/view", response_model=SignedUrlResponse)
async def view_document(
    doc_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    doc = await rest_get_one("documents", params={"id": f"eq.{doc_id}", "select": "storage_key"})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    await rest_rpc(
        "record_document_access",
        {"p_user_id": str(user["id"]), "p_document_id": str(doc_id), "p_downloaded": False},
    )

    signed = await asyncio.to_thread(_create_signed_url, doc["storage_key"], 1800)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=1800)
    return SignedUrlResponse(url=signed["signedURL"], expires_at=expires_at)


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    doc = await rest_get_one("documents", params={"id": f"eq.{doc_id}", "select": "storage_key,title"})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    await rest_rpc(
        "record_document_access",
        {"p_user_id": str(user["id"]), "p_document_id": str(doc_id), "p_downloaded": True},
    )

    signed = await asyncio.to_thread(_create_signed_url, doc["storage_key"], 60)
    signed_url = signed["signedURL"]

    async with httpx.AsyncClient() as client:
        resp = await client.get(signed_url)
        resp.raise_for_status()
        content = resp.content

    filename = f"{doc['title']}.pdf"
    return StreamingResponse(
        iter([content]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    doc_id: uuid.UUID,
    admin: Annotated[dict, Depends(require_admin)],
):
    """Admin-only: fetch a single document's current ingestion status, for polling after upload."""
    row = await rest_get_one("documents", params={"id": f"eq.{doc_id}"})
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentResponse(**row)
