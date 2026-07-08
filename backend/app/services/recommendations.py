import uuid

from app.supabase_rest import rest_post, rest_rpc


async def generate_recommendations(
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    concepts_missed_per_question: list[dict],
) -> None:
    """
    For each missed concept, find the most relevant chunk and create a recommendation.
    concepts_missed_per_question: list of {topic_id, concepts_missed: [...]}
    """
    priority = 1
    for item in concepts_missed_per_question:
        if not item.get("concepts_missed"):
            continue
        topic_id = item.get("topic_id")
        concept_query = " ".join(item["concepts_missed"])

        matches = await rest_rpc(
            "find_best_chunk_for_concepts",
            {"p_topic_id": str(topic_id) if topic_id else None, "p_concept_query": concept_query},
        )
        if not matches:
            continue
        match = matches[0]

        reason = f"Review this section to strengthen your understanding of: {', '.join(item['concepts_missed'][:3])}"

        # Plaintext in — recommendations_decrypted's INSTEAD OF INSERT trigger encrypts reason.
        await rest_post(
            "recommendations_decrypted",
            json={
                "user_id": str(user_id),
                "session_id": str(session_id),
                "chunk_id": match["chunk_id"],
                "topic_id": match["topic_id"] or (str(topic_id) if topic_id else None),
                "reason": reason,
                "priority": priority,
                "viewed": False,
            },
        )
        priority += 1
