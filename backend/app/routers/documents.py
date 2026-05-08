import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.auth import get_current_user, require_admin
from app.config import settings
from app.database import get_pool, get_supabase
from app.models.document import DocumentResponse, DocumentWithAccess, SignedUrlResponse
from app.services.ingestion import ingest_document

router = APIRouter()


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

    supabase = get_supabase()
    file_bytes = await file.read()
    supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).upload(
        storage_key, file_bytes, {"content-type": "application/pdf"}
    )

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO documents
              (id, title, author, document_type, difficulty, storage_key,
               ingestion_status, uploaded_by, uploaded_at, topic_id)
            VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,now(),$8)
            RETURNING *
            """,
            doc_id, title, author, document_type, difficulty, storage_key,
            admin["id"], uuid.UUID(topic_id) if topic_id else None,
        )

    tid = uuid.UUID(topic_id) if topic_id else None
    background_tasks.add_task(
        ingest_document,
        await get_pool(), doc_id, storage_key, tid, difficulty,
    )

    return DocumentResponse(**dict(row))


@router.get("/", response_model=list[DocumentResponse])
async def list_documents(user: Annotated[dict, Depends(get_current_user)]):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM documents WHERE ingestion_status = 'complete' ORDER BY uploaded_at DESC"
        )
    return [DocumentResponse(**dict(r)) for r in rows]


@router.get("/my-library", response_model=list[DocumentWithAccess])
async def my_library(user: Annotated[dict, Depends(get_current_user)]):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT d.id, d.title, d.author, d.document_type, d.difficulty,
                   d.total_pages, d.total_chunks, d.ingestion_status, d.uploaded_at, d.topic_id,
                   ud.last_accessed_at, ud.access_count, ud.downloaded,
                   ud.download_count, ud.last_downloaded_at
            FROM user_documents ud
            JOIN documents d ON ud.document_id = d.id
            WHERE ud.user_id = $1
            ORDER BY ud.last_accessed_at DESC
            """,
            user["id"],
        )
    return [DocumentWithAccess(**dict(r)) for r in rows]


@router.get("/{doc_id}/view", response_model=SignedUrlResponse)
async def view_document(
    doc_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        doc = await conn.fetchrow(
            "SELECT storage_key FROM documents WHERE id = $1", doc_id
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        await conn.execute(
            """
            INSERT INTO user_documents (id, user_id, document_id, first_accessed_at, last_accessed_at, access_count, downloaded, download_count)
            VALUES (gen_random_uuid(), $1, $2, now(), now(), 1, false, 0)
            ON CONFLICT (user_id, document_id) DO UPDATE
            SET last_accessed_at = now(), access_count = user_documents.access_count + 1
            """,
            user["id"], doc_id,
        )

    supabase = get_supabase()
    signed = supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).create_signed_url(
        doc["storage_key"], 1800
    )
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=1800)
    return SignedUrlResponse(url=signed["signedURL"], expires_at=expires_at)


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    import httpx

    pool = await get_pool()
    async with pool.acquire() as conn:
        doc = await conn.fetchrow(
            "SELECT storage_key, title FROM documents WHERE id = $1", doc_id
        )
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        await conn.execute(
            """
            INSERT INTO user_documents (id, user_id, document_id, first_accessed_at, last_accessed_at, access_count, downloaded, download_count, last_downloaded_at)
            VALUES (gen_random_uuid(), $1, $2, now(), now(), 1, true, 1, now())
            ON CONFLICT (user_id, document_id) DO UPDATE
            SET last_accessed_at = now(), access_count = user_documents.access_count + 1,
                downloaded = true, download_count = user_documents.download_count + 1,
                last_downloaded_at = now()
            """,
            user["id"], doc_id,
        )

    supabase = get_supabase()
    signed = supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).create_signed_url(
        doc["storage_key"], 60
    )
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
