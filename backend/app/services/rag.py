import asyncpg
from google import genai as google_genai

from app.config import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, settings

_client: google_genai.Client | None = None


def _get_client() -> google_genai.Client:
    global _client
    if _client is None:
        _client = google_genai.Client(api_key=settings.GOOGLE_API_KEY)
    return _client


HYBRID_SEARCH_SQL = """
SELECT
  dc.id,
  dc.content,
  dc.page_start,
  dc.page_end,
  dc.chapter,
  dc.section,
  dc.document_id,
  dc.topic_id,
  d.title   AS book_title,
  d.author  AS book_author,
  (
    0.6 * (1 - (dc.embedding <=> $1::vector))
    + 0.4 * ts_rank(dc.fts_vector, query)
  ) AS hybrid_score
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id,
  plainto_tsquery('english', $2) query
WHERE
  ($3::varchar IS NULL OR dc.difficulty = $3)
  AND dc.fts_vector @@ query
ORDER BY hybrid_score DESC
LIMIT $4;
"""


async def embed_text(text: str) -> list[float]:
    client = _get_client()
    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
        config={"task_type": "RETRIEVAL_QUERY"},
    )
    return list(result.embeddings[0].values)


async def hybrid_search(
    pool: asyncpg.Pool,
    query_text: str,
    difficulty: str | None,
    top_k: int,
) -> list[dict]:
    embedding = await embed_text(query_text)
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            HYBRID_SEARCH_SQL,
            embedding_str,
            query_text,
            difficulty,
            top_k,
        )

    return [dict(r) for r in rows]
