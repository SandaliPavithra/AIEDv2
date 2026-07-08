import asyncio
import io
import uuid

import pdfplumber
import tiktoken

from app.config import CHUNK_OVERLAP_TOKENS, CHUNK_TARGET_TOKENS, settings
from app.database import get_supabase
from app.logging_config import logger
from app.services.embedding import embed
from app.supabase_rest import rest_get, rest_patch, rest_post

_enc = tiktoken.get_encoding("cl100k_base")


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


def _download_and_prepare_chunks(
    storage_key: str,
) -> tuple[int, dict[int, tuple[str, str]], list[tuple[int, int]], list[tuple[int, int, str]]]:
    """All CPU/IO-bound synchronous work for one document: Storage download,
    PDF text extraction, chapter/section detection, and tokenizing/chunking.
    Called via asyncio.to_thread — on a large textbook this alone can take
    well over a minute, and none of it has anything to await, so run directly
    on the event loop it would block every other request on the server for
    that whole time (confirmed live: this was a real, repeated cause of the
    backend appearing to freeze during ingestion)."""
    supabase = get_supabase()
    logger.info("[ingestion.py] Downloading %s from bucket %s", storage_key, settings.SUPABASE_STORAGE_BUCKET)
    file_bytes = supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET).download(storage_key)
    logger.info("[ingestion.py] Downloaded %d bytes, extracting text page by page", len(file_bytes))

    page_texts: list[tuple[int, str]] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        total_pages = len(pdf.pages)
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            page_texts.append((i, text))
            if i % 25 == 0 or i == total_pages:
                logger.info("[ingestion.py] Extracted text from page %d/%d", i, total_pages)

    logger.info("[ingestion.py] Detecting chapter/section structure across %d pages", total_pages)
    page_structure = _extract_structure(page_texts)
    # Map: page_num → (chapter, section)
    page_meta: dict[int, tuple[str, str]] = {pn: (ch, sec) for pn, ch, sec in page_structure}

    full_text = "\n".join(t for _, t in page_texts)
    total_tokens = len(_enc.encode(full_text))

    # Build page boundary token offsets
    page_token_starts: list[tuple[int, int]] = []
    running = 0
    for page_num, pt in page_texts:
        page_token_starts.append((page_num, running))
        running += len(_enc.encode(pt)) + 1  # +1 for the newline separator

    raw_chunks = _chunk_text(full_text)
    logger.info(
        "[ingestion.py] Chunking complete: %d tokens -> %d chunks (target=%d, overlap=%d)",
        total_tokens, len(raw_chunks), CHUNK_TARGET_TOKENS, CHUNK_OVERLAP_TOKENS,
    )
    return total_pages, page_meta, page_token_starts, raw_chunks


async def ingest_document(
    document_id: uuid.UUID,
    storage_key: str,
    topic_id: uuid.UUID | None,
    difficulty: str,
) -> None:
    logger.info("[ingestion.py] Starting ingestion for document %s (storage_key=%s)", document_id, storage_key)
    await rest_patch("documents", params={"id": f"eq.{document_id}"}, json={"ingestion_status": "processing"})

    try:
        # A previous attempt may have partially inserted chunks before failing
        # (e.g. hitting the free-tier daily embedding quota mid-run). Resume
        # rather than restart: re-embedding an already-successful chunk wastes
        # a unit of the scarce resource (today's quota) for no reason. Skip
        # any chunk_index already present instead of deleting and redoing them.
        existing_rows = await rest_get(
            "document_chunks", params={"document_id": f"eq.{document_id}", "select": "chunk_index"}
        )
        existing_indices = {r["chunk_index"] for r in existing_rows}
        if existing_indices:
            logger.info(
                "[ingestion.py] Resuming: %d chunk(s) already ingested, skipping those", len(existing_indices)
            )

        total_pages, page_meta, page_token_starts, raw_chunks = await asyncio.to_thread(
            _download_and_prepare_chunks, storage_key
        )

        chunk_count = len(existing_indices)
        for idx, (tok_start, tok_end, chunk_text) in enumerate(raw_chunks):
            if idx in existing_indices:
                continue

            # Map token range → page range
            page_start = page_token_starts[0][0]
            page_end = page_token_starts[0][0]
            for pnum, ptok in page_token_starts:
                if ptok <= tok_start:
                    page_start = pnum
                if ptok <= tok_end:
                    page_end = pnum

            chapter, section = page_meta.get(page_start, ("", ""))

            logger.info(
                "[ingestion.py] Embedding chunk %d/%d (pages %d-%d, chapter=%r)",
                idx + 1, len(raw_chunks), page_start, page_end, chapter or None,
            )
            embedding = await embed(chunk_text, "RETRIEVAL_DOCUMENT")
            embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

            await rest_post(
                "document_chunks",
                json={
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
                },
            )
            chunk_count += 1

        await rest_patch(
            "documents",
            params={"id": f"eq.{document_id}"},
            json={"ingestion_status": "complete", "total_pages": total_pages, "total_chunks": chunk_count},
        )
        logger.info(
            "[ingestion.py] Ingestion complete for document %s: %d pages, %d chunks",
            document_id, total_pages, chunk_count,
        )

    except Exception as exc:
        logger.exception("[ingestion.py] Ingestion FAILED for document %s", document_id)
        await rest_patch("documents", params={"id": f"eq.{document_id}"}, json={"ingestion_status": "failed"})
        raise exc
