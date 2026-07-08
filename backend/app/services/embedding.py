import asyncio

from sentence_transformers import SentenceTransformer

from app.config import EMBEDDING_MODEL
from app.logging_config import logger

# BGE's own convention: prepend this instruction to queries only, never to
# the passages/documents being indexed — asymmetric retrieval, same split
# the codebase already had via task_type when this called Gemini's API.
_QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "

_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        logger.info("[embedding.py] Loading %s (first call downloads weights if not cached)", EMBEDDING_MODEL)
        _model = SentenceTransformer(EMBEDDING_MODEL)
    return _model


def _encode(text: str, task_type: str) -> list[float]:
    model = _get_model()
    if task_type == "RETRIEVAL_QUERY":
        text = _QUERY_INSTRUCTION + text
    vector = model.encode(text, normalize_embeddings=True)
    return vector.tolist()


async def embed(text: str, task_type: str) -> list[float]:
    """Embed text locally via BAAI/bge-base-en-v1.5 — native 768-dim output,
    exact match for the schema's VECTOR(768) columns, no truncation needed.
    Replaced Gemini's embedContent after repeatedly hitting its free-tier
    1000/day quota mid-ingestion (see TECHNICAL_LOG.md) — no rate limits here
    since it runs locally.

    sentence-transformers' encode() is a blocking CPU call, so it runs in a
    thread rather than directly on the event loop — keeps the server
    responsive (live log stream, other requests) during a long ingestion run.
    """
    return await asyncio.to_thread(_encode, text, task_type)
