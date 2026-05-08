import json

from openai import AsyncOpenAI

from app.config import GROK_MODEL, HALLUCINATION_CONFIG, settings

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=settings.XAI_API_KEY,
            base_url="https://api.x.ai/v1",
        )
    return _client


HALLUCINATION_SYSTEM = (
    "You are a strict fact-checker. Given a source chunk and an evaluation, "
    "determine whether the evaluation contains any hallucinated claims — "
    "i.e. claims about the student answer or source material that are not "
    "supported by the source chunk. "
    "Respond ONLY with valid JSON: "
    '{"hallucination_flag": true|false, "hallucination_note": "description or null"}'
)


async def check_hallucination(
    evaluation_text: str,
    source_chunk: str,
) -> tuple[bool, str | None]:
    client = _get_client()

    response = await client.chat.completions.create(
        model=GROK_MODEL,
        temperature=HALLUCINATION_CONFIG["temperature"],
        top_p=HALLUCINATION_CONFIG["top_p"],
        messages=[
            {"role": "system", "content": HALLUCINATION_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Source chunk:\n{source_chunk}\n\n"
                    f"Evaluation:\n{evaluation_text}"
                ),
            },
        ],
    )

    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    result = json.loads(raw)
    return result["hallucination_flag"], result.get("hallucination_note")
