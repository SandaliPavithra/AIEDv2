import json

from anthropic import AsyncAnthropic

from app.config import CLAUDE_EVALUATION_MODEL, EVALUATION_CONFIG, settings

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


EVALUATION_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "factual_correctness_score": {"type": "integer"},
        "structure_score": {"type": "integer"},
        "precision_score": {"type": "integer"},
        "recall_score": {"type": "integer"},
        "wording_score": {"type": "integer"},
        "concepts_covered": {"type": "array", "items": {"type": "string"}},
        "concepts_missed": {"type": "array", "items": {"type": "string"}},
        "feedback_text": {"type": "string"},
    },
    "required": [
        "factual_correctness_score", "structure_score", "precision_score", "recall_score",
        "wording_score", "concepts_covered", "concepts_missed", "feedback_text",
    ],
    "additionalProperties": False,
}


EVALUATION_SYSTEM_PROMPT = """You are a rigorous but fair academic evaluator for an AI/ML education platform.

Evaluate student answers against the source material and expected concepts. Be style-neutral — do not penalise for regional writing styles or unconventional phrasing if the meaning is correct.

Scoring dimensions (all 0-100):
- factual_correctness_score: Is the answer factually accurate against the source chunk?
- structure_score: Is the answer clear and understandable to an outside reader?
- precision_score: Is the content the student wrote relevant (no irrelevant padding)?
- recall_score: What fraction of expected_concepts did the answer cover? (concepts_covered / total_expected)
- wording_score: Bias-neutral clarity. Reward correct meaning regardless of writing style.

feedback_text: constructive feedback in 2-4 sentences."""


async def evaluate_answer(
    question_text: str,
    expected_concepts: list[str],
    answer_text: str,
    source_chunk: str,
) -> dict:
    client = _get_client()

    user_content = (
        f"Source chunk:\n{source_chunk}\n\n"
        f"Question:\n{question_text}\n\n"
        f"Expected concepts: {json.dumps(expected_concepts)}\n\n"
        f"Student answer:\n{answer_text}\n\n"
        "Evaluate this answer."
    )

    response = await client.messages.create(
        model=CLAUDE_EVALUATION_MODEL,
        max_tokens=1024,
        system=EVALUATION_SYSTEM_PROMPT,
        temperature=EVALUATION_CONFIG["temperature"],
        top_p=EVALUATION_CONFIG["top_p"],
        output_config={"format": {"type": "json_schema", "schema": EVALUATION_OUTPUT_SCHEMA}},
        messages=[{"role": "user", "content": user_content}],
    )

    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)
