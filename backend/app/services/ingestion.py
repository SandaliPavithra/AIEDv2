import io
import uuid

import asyncpg
import pdfplumber
import tiktoken
from google import genai as google_genai

from app.config import (
    CHUNK_OVERLAP_TOKENS,
    CHUNK_TARGET_TOKENS,
    EMBEDDING_MODEL,
    settings,
)
from app.database import get_supabase

_enc = tiktoken.get_encoding("cl100k_base")
_google_client: google_genai.Client | None = None


def _get_google_client() -> google_genai.Client:
    global _google_client
    if _google_client is None:
        _google_client = google_genai.Client(api_key=settings.GOOGLE_API_KEY)
    return _google_client


def _token_count(text: str) -> int:
    return len(_enc.encode(text))


def _chunk_text(text: str) -> list[tuple[int, int, str]]:
    """Return list of (token_start, token_end, chunk_text) tuples."""
    tokens = _enc.encode(text)
    chunks: list[tuple[int, int, str]] = []
    start = 0
    while start < len(tokens):
        end = min(start + CHUNK_TARGET_TOKENS, len(tokens))
        chunk_tokens = tokens[start:end]
        chunks.append((start, end, _enc.decode(chunk_tokens)))
        if end == len(tokens):
            break
        start += CHUNK_TARGET_TOKENS - CHUNK_OVERLAP_TOKENS
    return chunks


async def _embed(text: str) -> list[float]:
    client = _get_google_client()
    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
        config={"task_type": "RETRIEVAL_DOCUMENT"},
    )
    return list(result.embeddings[0].values)


def _extract_structure(pages: list[tuple[int, str]]) -> list[tuple[int, str, str]]:
    """
    Heuristically detect chapter/section headings per page.
    Returns list of (page_num, chapter, section).
    A line is treated as a heading if it is:
      - Short (≤ 80 chars), title-cased or ALL CAPS
      - Does not end with punctuation
    """
    result = []
    current_chapter = ""
    current_section = ""
    for page_num, text in pages:
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or len(stripped) > 80:
                continue
            if stripped.endswith((".", ",", ";")):
                continue
            if stripped.isupper() or stripped.istitle():
                words = stripped.split()
                if len(words) <= 8:
                    if any(kw in stripped.lower() for kw in ("chapter", "part", "unit", "module")):
                        current_chapter = stripped
                        current_section = ""
                    else:
                        current_section = stripped
        result.append((page_num, current_chapter, current_section))
    return result


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

        page_texts: list[tuple[int, str]] = []
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            total_pages = len(pdf.pages)
            for i, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                page_texts.append((i, text))

        page_structure = _extract_structure(page_texts)
        # Map: page_num → (chapter, section)
        page_meta: dict[int, tuple[str, str]] = {
            pn: (ch, sec) for pn, ch, sec in page_structure
        }

        full_text = "\n".join(t for _, t in page_texts)
        tokens_full = _enc.encode(full_text)
        total_tokens = len(tokens_full)

        # Build page boundary token offsets
        page_token_starts: list[tuple[int, int]] = []
        running = 0
        for page_num, pt in page_texts:
            page_token_starts.append((page_num, running))
            running += len(_enc.encode(pt)) + 1  # +1 for the newline separator

        raw_chunks = _chunk_text(full_text)

        chunks_data: list[dict] = []
        for idx, (tok_start, tok_end, chunk_text) in enumerate(raw_chunks):
            # Map token range → page range
            page_start = page_token_starts[0][0]
            page_end = page_token_starts[0][0]
            for pnum, ptok in page_token_starts:
                if ptok <= tok_start:
                    page_start = pnum
                if ptok <= tok_end:
                    page_end = pnum

            chapter, section = page_meta.get(page_start, ("", ""))

            embedding = await _embed(chunk_text)
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

            chunks_data.append({
                "id": str(uuid.uuid4()),
                "document_id": str(document_id),
                "topic_id": str(topic_id) if topic_id else None,
                "chunk_index": idx,
                "content": chunk_text,
                "page_start": page_start,
                "page_end": page_end,
                "chapter": chapter,
                "section": section,
                "difficulty": difficulty,
                "embedding": embedding_str,
            })

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
