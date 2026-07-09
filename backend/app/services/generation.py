import json

from anthropic import AsyncAnthropic

from app.config import CLAUDE_GENERATION_MODEL, GENERATION_CONFIG, settings

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


# additionalProperties:false requires every key in "required" — nullable
# fields use a null-inclusive type instead of being omitted, since the two
# response shapes (skip vs. real question) share one schema.
#
# question_type can't follow that same type-array pattern: Claude's schema
# validator rejects combining an array `type` with `enum` on the same node
# (confirmed live — "Enum value 'short_answer' does not match declared type
# '['string', 'null']'", reproduced then fixed via a minimal probe script
# before touching this file). `anyOf` is the form it actually accepts.
GENERATION_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "skip": {"type": "boolean"},
        "question_text": {"type": ["string", "null"]},
        "question_type": {
            "anyOf": [
                {"type": "string", "enum": ["short_answer", "long_answer", "mcq"]},
                {"type": "null"},
            ]
        },
        "options": {"type": ["array", "null"], "items": {"type": "string"}},
        "correct_index": {"type": ["integer", "null"]},
        "expected_concepts": {"type": ["array", "null"], "items": {"type": "string"}},
        "expected_time_seconds": {"type": ["integer", "null"]},
    },
    "required": [
        "skip", "question_text", "question_type", "options",
        "correct_index", "expected_concepts", "expected_time_seconds",
    ],
    "additionalProperties": False,
}


GENERATION_SYSTEM_PROMPT = """You are an expert college-level educator writing exam questions based on \
excerpts from a course textbook, for whatever subject and topic you are told for this call.

Your task: generate ONE high-quality, conceptually substantive question from the provided text chunk, \
about the SUBJECT MATTER being taught — never about the book itself.

WHAT MAKES A GOOD QUESTION (required):
- Tests understanding of a concept, mechanism, comparison, distinction, or principle from the subject
  matter — e.g. "What is the difference between X and Y?", "What distinguishes X from Y?", "Why does X
  happen under condition Y?", "How does X affect Y?".
- Never asks about the author's biography, credentials, career history, publisher, professional
  societies mentioned in passing, dedication, foreword, or acknowledgments — none of that is the
  subject being taught, even if it's the only thing present in the given chunk.
- Prefers reasoning and comparison over "which of these four facts is literally stated in the text."
- Even for multiple choice, wrong options should be plausible misconceptions a real student might
  hold — not arbitrary unrelated facts from the same page.
- Must stand alone: the student sees ONLY question_text (plus options, for MCQ) — never the source
  chunk you were given. Never write "the examples provided", "the text states", "as discussed above",
  "in this passage", "the following", or any other phrase that assumes the reader has the chunk in
  front of them. If the chunk illustrates a concept with a specific example, name that example
  explicitly inside question_text itself rather than pointing back at it.
- Written at college level: assumes a serious student of the subject, not a casual reader skimming
  for trivia.

WHEN TO SKIP (set skip=true and leave every other field null):
- The chunk is front matter, a biography, acknowledgments, a table of contents, an index, or a
  references/bibliography list.
- The chunk is too fragmentary (an isolated list, a citation block, a page header/footer) to support
  a substantive question.
Do not force a question out of unsuitable material — skipping is correct and expected sometimes.

DIFFICULTY maps to student level, not "book difficulty" (a book doesn't have a difficulty — a student does):
- easy = beginner — foundational definitions and basic distinctions.
- medium = intermediate — mechanisms, trade-offs, how concepts relate to each other.
- hard = advanced — nuanced edge cases, synthesis across multiple concepts, critical evaluation of a
  claim or method.

Other rules:
- Set expected_time_seconds based on question type and difficulty (mcq=45s, short_answer easy=90s
  medium=120s hard=180s, long_answer easy=240s medium=360s hard=480s).
- For MCQ questions, question_text is ONLY the question itself — do NOT embed the options in it.
  Return exactly 4 options in the "options" array and the 0-based index of the correct one in
  "correct_index". For non-MCQ questions, set "options" and "correct_index" to null.
- expected_concepts should be 3-7 specific concepts a complete answer must contain."""


async def generate_question(
    chunk: dict,
    question_type: str,
    difficulty: str,
    topic_name: str,
) -> dict:
    config = GENERATION_CONFIG[difficulty]
    client = _get_client()

    user_content = (
        f"Topic: {topic_name}\n"
        f"Difficulty (student level): {difficulty}\n"
        f"Question type: {question_type}\n\n"
        f"Text chunk:\n{chunk['content']}\n\n"
        f"Generate one question that tests understanding of {topic_name} concepts found in this chunk, "
        "or skip if this chunk isn't suitable subject matter, per the system rules."
    )

    response = await client.messages.create(
        model=CLAUDE_GENERATION_MODEL,
        max_tokens=1024,
        system=GENERATION_SYSTEM_PROMPT,
        # Claude rejects temperature+top_p together ("cannot both be specified
        # for this model") — confirmed live via a minimal probe. top_p stays
        # in GENERATION_CONFIG and gets recorded on the session row for
        # provenance; it's just not sent to the API call itself.
        temperature=config["temperature"],
        output_config={"format": {"type": "json_schema", "schema": GENERATION_OUTPUT_SCHEMA}},
        messages=[{"role": "user", "content": user_content}],
    )

    text = next(block.text for block in response.content if block.type == "text")
    return json.loads(text)
