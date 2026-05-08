import uuid

import asyncpg


async def generate_recommendations(
    pool: asyncpg.Pool,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    concepts_missed_per_question: list[dict],
) -> None:
    """
    For each missed concept, find the most relevant chunk and create a recommendation.
    concepts_missed_per_question: list of {topic_id, concepts_missed: [...]}
    """
    priority = 1
    async with pool.acquire() as conn:
        for item in concepts_missed_per_question:
            if not item.get("concepts_missed"):
                continue
            topic_id = item.get("topic_id")
            concept_query = " ".join(item["concepts_missed"])

            # Find best matching chunk by FTS
            row = await conn.fetchrow(
                """
                SELECT dc.id, dc.topic_id
                FROM document_chunks dc
                WHERE ($1::uuid IS NULL OR dc.topic_id = $1)
                  AND dc.fts_vector @@ plainto_tsquery('english', $2)
                ORDER BY ts_rank(dc.fts_vector, plainto_tsquery('english', $2)) DESC
                LIMIT 1
                """,
                topic_id,
                concept_query,
            )
            if not row:
                continue

            reason = f"Review this section to strengthen your understanding of: {', '.join(item['concepts_missed'][:3])}"

            await conn.execute(
                """
                INSERT INTO recommendations
                  (id, user_id, session_id, chunk_id, topic_id, reason, priority, viewed, created_at)
                VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, false, now())
                """,
                user_id, session_id, row["id"], row["topic_id"] or topic_id,
                reason, priority,
            )
            priority += 1
