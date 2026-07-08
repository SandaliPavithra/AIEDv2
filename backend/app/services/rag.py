from app.services.embedding import embed
from app.supabase_rest import rest_rpc


async def embed_text(text: str) -> list[float]:
    return await embed(text, "RETRIEVAL_QUERY")


async def hybrid_search(query_text: str, difficulty: str | None, top_k: int) -> list[dict]:
    embedding = await embed_text(query_text)
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    rows = await rest_rpc(
        "hybrid_search",
        {
            "p_query_embedding": embedding_str,
            "p_query_text": query_text,
            "p_difficulty": difficulty,
            "p_top_k": top_k,
        },
    )
    return rows or []
