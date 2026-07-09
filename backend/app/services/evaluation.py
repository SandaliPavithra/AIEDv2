import json

from anthropic import AsyncAnthropic

from app.config import CLAUDE_EVALUATION_MODEL, settings

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
        # claude-sonnet-5 rejects temperature AND top_p individually ("`x` is
        # deprecated for this model") when using structured output — a
        # stricter version of generation.py's Haiku restriction (which only
        # rejects the *combination*, either one alone is fine there). Confirmed
        # live via probe against this exact model before landing this fix —
        # this is the first time evaluate_answer() was ever actually invoked,
        # and it 500'd every time until this. EVALUATION_CONFIG's values are
        # still recorded on the evaluations row for provenance, just not sent
        # to the API call itself.
        output_config={"format": {"type": "json_schema", "schema": EVALUATION_OUTPUT_SCHEMA}},
        messages=[{"role": "user", "content": user_content}],
    )

    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)


MCQ_EXPLANATION_SCHEMA = {
    "type": "object",
    "properties": {"explanation": {"type": "string"}},
    "required": ["explanation"],
    "additionalProperties": False,
}

MCQ_EXPLANATION_SYSTEM_PROMPT = """You are a college-level educator giving feedback on a multiple-choice \
quiz answer. Correctness has already been determined — you're told which option is correct and which \
one the student picked. Don't re-derive or contradict that; your job is purely to explain it well.

Write ONE short paragraph (4-6 sentences) that:
- Opens by confirming whether the student's answer was correct or incorrect.
- Explains why the correct option is right, grounded in the source chunk.
- Explains why EACH of the other (incorrect) options is wrong — name the specific misconception or \
error each one represents, don't just say "it's wrong."

Never write "the text states", "as shown above", or similar phrases that assume the reader has the source \
chunk in front of them — explain the underlying concept directly."""


async def explain_mcq_answer(
    question_text: str,
    options: list[str],
    correct_index: int,
    selected_text: str,
    is_correct: bool,
    source_chunk: str,
) -> str:
    """MCQ correctness is a deterministic lookup (see _score_mcq in the
    evaluations router) — this call's only job is the qualitative "why" for
    all four options, which is genuinely a language task worth an AI call,
    unlike the correctness fact itself."""
    client = _get_client()
    lettered_options = "\n".join(f"{chr(65 + i)}. {opt}" for i, opt in enumerate(options))

    user_content = (
        f"Question: {question_text}\n\n"
        f"Options:\n{lettered_options}\n\n"
        f"Correct option: {chr(65 + correct_index)}. {options[correct_index]}\n"
        f'Student selected: "{selected_text}" — this was {"correct" if is_correct else "incorrect"}.\n\n'
        f"Source chunk:\n{source_chunk}\n\n"
        "Write the feedback paragraph now."
    )

    response = await client.messages.create(
        model=CLAUDE_EVALUATION_MODEL,
        max_tokens=512,
        system=MCQ_EXPLANATION_SYSTEM_PROMPT,
        output_config={"format": {"type": "json_schema", "schema": MCQ_EXPLANATION_SCHEMA}},
        messages=[{"role": "user", "content": user_content}],
    )

    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)["explanation"]
