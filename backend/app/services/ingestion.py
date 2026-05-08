import io
import uuid
from typing import BinaryIO

import asyncpg
import google.generativeai as genai
import pdfplumber
import tiktoken

from app.config import (
    CHUNK_OVERLAP_TOKENS,
    CHUNK_TARGET_TOKENS,
    EMBEDDING_MODEL,
    settings,
)
from app.database import get_supabase

genai.configure(api_key=settings.GOOGLE_API_KEY)
_enc = tiktoken.get_encoding("cl100k_base")


def _token_count(text: str) -> int:
    return len(_enc.encode(text))


def _chunk_text(text: str) -> list[str]:
    tokens = _enc.encode(text)
    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = min(start + CHUNK_TARGET_TOKENS, len(tokens))
        chunk_tokens = tokens[start:end]
        chunks.append(_enc.decode(chunk_tokens))
        start += CHUNK_TARGET_TOKENS - CHUNK_OVERLAP_TOKENS
    return chunks


async def _embed(text: str) -> list[float]:
    result = genai.embed_content(
        model=EMBEDDING_MODEL,
        content=text,
        task_type="retrieval_document",
    )
    return result["embedding"]


async def ingest_document(
    pool: asyncpg.Pool,
    document_id: uuid.UUID,
    storage_key: str,
    topic_id: uuid.UUID | None,
    difficulty: str,
) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE documents SET ingestion_status = 'processing' WHERE id = $1",
            document_id,
        )

    try:
        supabase = get_supabase()
        file_bytes = supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).download(
            storage_key
        )

        chunks_data: list[dict] = []
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            total_pages = len(pdf.pages)
            current_text = ""
            current_page_start = 1
            current_chapter = ""
            current_section = ""

            page_texts: list[tuple[int, str]] = []
            for i, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                page_texts.append((i, text))

            full_text = "\n".join(t for _, t in page_texts)
            raw_chunks = _chunk_text(full_text)

            # Map chunks back to approximate page numbers
            char_offset = 0
            page_char_offsets: list[tuple[int, int]] = []
            running = 0
            for page_num, pt in page_texts:
                page_char_offsets.append((page_num, running))
                running += len(pt) + 1

            full_text_chars = len(full_text)
            chunk_char_start = 0
            for idx, chunk in enumerate(raw_chunks):
                chunk_len = len(chunk)
                chunk_char_end = chunk_char_start + chunk_len

                # Find page range
                page_start = 1
                page_end = total_pages
                for pnum, poff in page_char_offsets:
                    if poff <= chunk_char_start:
                        page_start = pnum
                    if poff <= chunk_char_end:
                        page_end = pnum

                embedding = await _embed(chunk)
                embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

                chunks_data.append({
                    "id": str(uuid.uuid4()),
                    "document_id": str(document_id),
                    "topic_id": str(topic_id) if topic_id else None,
                    "chunk_index": idx,
                    "content": chunk,
                    "page_start": page_start,
                    "page_end": page_end,
                    "chapter": "",
                    "section": "",
                    "difficulty": difficulty,
                    "embedding": embedding_str,
                })
                chunk_char_start += CHUNK_TARGET_TOKENS * 3 - CHUNK_OVERLAP_TOKENS * 3

        async with pool.acquire() as conn:
            async with conn.transaction():
                for c in chunks_data:
                    await conn.execute(
                        """
                        INSERT INTO document_chunks
                          (id, document_id, topic_id, chunk_index, content,
                           page_start, page_end, chapter, section, difficulty, embedding)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector)
                        """,
                        c["id"], c["document_id"], c["topic_id"], c["chunk_index"],
                        c["content"], c["page_start"], c["page_end"],
                        c["chapter"], c["section"], c["difficulty"], c["embedding"],
                    )

                await conn.execute(
                    """
                    UPDATE documents
                    SET ingestion_status = 'complete',
                        total_pages = $2,
                        total_chunks = $3
                    WHERE id = $1
                    """,
                    str(document_id), total_pages, len(chunks_data),
                )

    except Exception as exc:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE documents SET ingestion_status = 'failed' WHERE id = $1",
                document_id,
            )
        raise exc
