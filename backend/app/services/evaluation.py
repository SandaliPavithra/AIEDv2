import json

from anthropic import AsyncAnthropicBedrockMantle

from app.config import EVALUATION_CONFIG, SONNET_MODEL, settings

_client: AsyncAnthropicBedrockMantle | None = None


def _get_client() -> AsyncAnthropicBedrockMantle:
    global _client
    if _client is None:
        _client = AsyncAnthropicBedrockMantle(aws_region=settings.AWS_REGION)
    return _client


EVALUATION_SYSTEM_PROMPT = """You are a rigorous but fair academic evaluator for an AI/ML education platform.

Evaluate student answers against the source material and expected concepts. Be style-neutral — do not penalise for regional writing styles or unconventional phrasing if the meaning is correct.

Scoring dimensions (all 0-100):
- factual_correctness_score: Is the answer factually accurate against the source chunk?
- structure_score: Is the answer clear and understandable to an outside reader?
- precision_score: Is the content the student wrote relevant (no irrelevant padding)?
- recall_score: What fraction of expected_concepts did the answer cover? (concepts_covered / total_expected)
- wording_score: Bias-neutral clarity. Reward correct meaning regardless of writing style.

Respond with ONLY valid JSON:
{
  "factual_correctness_score": 0-100,
  "structure_score": 0-100,
  "precision_score": 0-100,
  "recall_score": 0-100,
  "wording_score": 0-100,
  "concepts_covered": ["concept1"],
  "concepts_missed": ["concept2"],
  "feedback_text": "Constructive feedback in 2-4 sentences."
}"""


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
        model=SONNET_MODEL,
        max_tokens=1024,
        temperature=EVALUATION_CONFIG["temperature"],
        top_p=EVALUATION_CONFIG["top_p"],
        system=[
            {
                "type": "text",
                "text": EVALUATION_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_content}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)
