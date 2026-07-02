import json
import uuid

from anthropic import AsyncAnthropicBedrockMantle

from app.config import GENERATION_CONFIG, HAIKU_MODEL, settings

_client: AsyncAnthropicBedrockMantle | None = None


def _get_client() -> AsyncAnthropicBedrockMantle:
    global _client
    if _client is None:
        _client = AsyncAnthropicBedrockMantle(aws_region=settings.AWS_REGION)
    return _client


GENERATION_SYSTEM_PROMPT = """You are an expert educational question generator for an AI/ML course platform.

Your task is to generate a single high-quality question from a provided text chunk.

Rules:
- The question must be answerable solely from the provided chunk.
- Extract the key concepts that a correct answer must cover.
- Set expected_time_seconds based on question type and difficulty (mcq=45s, short_answer easy=90s medium=120s hard=180s, long_answer easy=240s medium=360s hard=480s).
- For MCQ questions, include the question and 4 options (A-D) in the question_text, with the correct answer indicated.
- expected_concepts should be 3-7 specific concepts/facts a complete answer must contain.

Respond with ONLY valid JSON matching this schema:
{
  "question_text": "string",
  "question_type": "mcq|short_answer|long_answer",
  "expected_concepts": ["concept1", "concept2"],
  "expected_time_seconds": 90
}"""


async def generate_question(
    chunk: dict,
    question_type: str,
    difficulty: str,
) -> dict:
    config = GENERATION_CONFIG[difficulty]
    client = _get_client()

    user_content = (
        f"Difficulty: {difficulty}\n"
        f"Question type: {question_type}\n\n"
        f"Text chunk:\n{chunk['content']}\n\n"
        "Generate one question from this chunk."
    )

    response = await client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=1024,
        temperature=config["temperature"],
        top_p=config["top_p"],
        system=[
            {
                "type": "text",
                "text": GENERATION_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_content}],
    )

    raw = response.content[0].text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw)
