import json
from typing import Annotated

from fastapi import APIRouter, Depends

from anthropic import AsyncAnthropic

from app.auth import get_current_user
from app.config import CLAUDE_CHATBOT_MODEL, settings
from app.models.progress import ChatMessageRequest, ChatMessageResponse
from app.supabase_rest import rest_get, rest_post

router = APIRouter()

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


# Structured output, not free-text parsing: the model MUST return this exact
# shape (same json_schema pattern as evaluation.py/generation.py), so a chart
# either validly exists or chart.kind is "none" — never a malformed guess at
# parsing chart-ish text out of prose.
CHAT_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "reply_text": {"type": "string"},
        "chart": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["none", "line", "bar"]},
                "title": {"type": "string"},
                "x_labels": {"type": "array", "items": {"type": "string"}},
                "series": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "values": {"type": "array", "items": {"type": "number"}},
                        },
                        "required": ["name", "values"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["kind", "title", "x_labels", "series"],
            "additionalProperties": False,
        },
    },
    "required": ["reply_text", "chart"],
    "additionalProperties": False,
}


SYSTEM_PROMPT_TEMPLATE = """You are an academic evaluation analyst for an AI/ML education platform. Your job \
is to explain a specific student's real, already-computed evaluation and behavioural data precisely and \
honestly. Every number below was already produced by a deterministic pipeline before this conversation \
started — you are interpreting it, not scoring or judging the student yourself, and never inventing a \
score, trend, or behaviour that isn't in the data below.

RUBRIC — what each field actually measures (use this to interpret, don't just repeat numbers):
- recall: % of the question's expected concepts the answer actually covered. Low recall = missing ideas,
  not poor phrasing of the ideas that were there.
- precision: how much of what was written was relevant (no padding/irrelevant content).
- wording: bias-neutral clarity, deliberately designed to NOT penalise regional or non-native English writing
  styles — the rubric explicitly rewards correct meaning regardless of phrasing. A low wording score means the
  answer was unclear or hard to follow for ANY reader, not that English is a second language for this student.
  Do not conclude ESL/language-background from this score.
- conciseness: penalises only rambling past an expected length for the question type — never penalises being
  short (that's recall's job instead).
- copy_similarity: % of the answer's own 8-word phrases that appear verbatim in the source material. Above
  ~40 is a real signal of copying, not paraphrasing.
- active_time_seconds / total_elapsed_seconds: how long they actually engaged with the question vs. wall clock.
- pause_count / distraction_ratio: how often and how much they looked away (tab-switched, lost focus) —
  distraction, not necessarily struggling.
- answer_start_delay_seconds: gap between opening the question and typing the first keystroke — hesitation.
- revision_count: how many times they edited after their first pass — active reworking vs. one-shot answers.
- behaviour_label: confident / struggling / distracted / guessing / neutral, computed from the above.

CRITICAL — multiple-choice vs free-text are NOT comparable evidence of understanding. An MCQ's score is a
flat 100 (correct) or 0 (incorrect) copied across every dimension — it is a correctness fact, nothing more.
NEVER cite an MCQ result as evidence of "excellent understanding," blend it into a trend with free-text
scores, or let it anchor a narrative about improvement/decline. Always call out explicitly when a data point
is MCQ-only correctness rather than a rubric judgement. More specifically: if a high MCQ score and low
free-text scores appear together, you MUST directly address whether the gap is explained by question
FORMAT (recognizing a correct option among choices is a fundamentally easier cognitive task than producing
an answer from memory) rather than by any actual change in the student's understanding — do not leave this
unexamined.

Each answer below includes the actual question text. Use it to judge the KIND of cognitive demand involved —
e.g. recognition/recall of a stated fact, vs. explaining a mechanism, vs. synthesizing multiple concepts, vs.
open-ended/creative reasoning — not just the mechanical question_type label. Explicitly identify which kinds
of questions this student performs best and worst on, as a direct finding (e.g. "recognition-style questions
score well; questions requiring you to connect multiple concepts score poorly"), whenever the data supports it.

Student's per-topic progress (latest snapshot per topic — note these averages blend MCQ correctness with
free-text depth-of-understanding scores; caveat this if it matters to your answer):
{progress_summary}

Student's most recently evaluated answers, each with its question text, difficulty, and behavioural/timing
data (newest first):
{recent_evaluations}

Give a genuinely analytical answer, not a stats recap: assess concept mastery (what's actually understood
vs. missing, using concepts_missed), communication quality (using wording, correctly per the rubric note
above), what kind of questions this student is actually strong/weak at (per the instruction above), and
behavioural patterns (hesitation via start_delay, focus via distraction_ratio/pause_count, effort via
revision_count and active_time vs. what the question expected).

Do not end by telling the student to "figure out," "diagnose," or "reflect on" what changed — that pushes the
analysis back onto them. Commit to your single best-supported explanation from the evidence above, state it
directly, and give specific, actionable remedies tied to the actual evidence (e.g. name the specific concept
to re-study, the specific behavioural pattern to change and how, not "practice more" or "focus better").
Short paragraphs, not a wall of stats.

You respond as JSON: {{"reply_text": "...", "chart": {{...}}}}. reply_text is your prose answer (Markdown
bold/bullets are fine, they render).

DEFAULT TO INCLUDING A CHART. If your answer discusses two or more numeric values that could sit side by
side — scores across multiple answers (even just 2-4), several dimensions of one answer (recall/precision/
wording/conciseness), multiple topics, or any comparison at all — you MUST set chart.kind to "line" (an
ordered sequence, e.g. answers over time) or "bar" (discrete categories, e.g. dimensions or topics) and
populate it from those exact numbers. Only a small number of comparable points (e.g. 2, or only one
MCQ-vs-free-text pair) is NOT a reason to skip the chart — chart what you have; the reply_text can still note
the sample size is small. Use chart.kind "none" only when the answer is genuinely non-quantitative (e.g. pure
study-technique advice with no numbers being compared).

x_labels are the real labels behind each point/bar (dates, topic names, dimension names — never invented);
series is 1-3 entries, each a short "name" and a "values" array the exact same length as x_labels, every
number copied directly from the data above, never estimated; title is short and specific (e.g. "Recall across
your last 4 answers", not "Chart"). Cap it at 3 series and 8 x_labels — pick the most relevant subset rather
than cramming in everything."""


def _format_progress(rows: list[dict], topic_names: dict[str, str]) -> str:
    if not rows:
        return "No completed sessions yet — no progress data exists for this student."
    lines = []
    for r in rows:
        topic = topic_names.get(r["topic_id"], r["topic_id"])
        lines.append(
            f"- {topic}: avg_final_score={r.get('avg_final_score')}, avg_raw_score={r.get('avg_raw_score')}, "
            f"avg_recall={r.get('avg_recall')}, avg_precision={r.get('avg_precision')}, "
            f"avg_conciseness={r.get('avg_conciseness')}, avg_copy_similarity={r.get('avg_copy_similarity')}, "
            f"dominant_behaviour={r.get('dominant_behaviour')}, questions_attempted={r.get('questions_attempted')}, "
            f"snapshot_date={r.get('snapshot_date')}"
        )
    return "\n".join(lines)


def _format_evaluations(
    rows: list[dict],
    behaviour_by_answer: dict[str, dict],
    questions_by_id: dict[str, dict],
) -> str:
    if not rows:
        return "No evaluated answers yet."
    lines = []
    for r in rows:
        question = questions_by_id.get(r["question_id"], {})
        qtype = question.get("question_type", "unknown")
        qtext = question.get("question_text", "(question text unavailable)")
        difficulty = question.get("difficulty", "unknown")
        b = behaviour_by_answer.get(r["answer_id"])
        behaviour_bits = (
            f"active_time={b['active_time_seconds']}s, total_elapsed={b['total_elapsed_seconds']}s, "
            f"pause_count={b['pause_count']}, distraction_ratio={b['distraction_ratio']}, "
            f"start_delay={b['answer_start_delay_seconds']}s, revision_count={b['revision_count']}, "
            f"behaviour_label={b['behaviour_label']}"
            if b else "no behavioural data recorded for this answer"
        )
        if qtype == "mcq":
            lines.append(
                f'- [MULTIPLE CHOICE — correctness only, not a rubric judgement] question="{qtext}" '
                f"(difficulty={difficulty}), final_score={r.get('final_score')} (100=correct option, 0=incorrect), "
                f"{behaviour_bits}, created_at={r.get('created_at')}"
            )
        else:
            lines.append(
                f'- [{qtype.upper()}] question="{qtext}" (difficulty={difficulty}), '
                f"final_score={r.get('final_score')}, recall={r.get('recall_score')}, "
                f"precision={r.get('precision_score')}, wording={r.get('wording_score')}, "
                f"conciseness={r.get('conciseness_score')}, copy_similarity={r.get('copy_similarity_score')}, "
                f"concepts_missed={r.get('concepts_missed')}, hallucination_flag={r.get('hallucination_flag')}, "
                f"{behaviour_bits}, created_at={r.get('created_at')}"
            )
    return "\n".join(lines)


async def _build_system_prompt(user_id: str) -> str:
    progress_rows = await rest_get(
        "progress_snapshots_decrypted",
        params={"user_id": f"eq.{user_id}", "order": "snapshot_date.desc"},
    )
    # Keep only the latest snapshot per topic (rows are newest-first).
    latest_by_topic: dict[str, dict] = {}
    for row in progress_rows:
        latest_by_topic.setdefault(row["topic_id"], row)

    topic_names: dict[str, str] = {}
    if latest_by_topic:
        topics = await rest_get(
            "topics",
            params={"id": f"in.({','.join(latest_by_topic)})", "select": "id,name"},
        )
        topic_names = {t["id"]: t["name"] for t in topics}

    eval_rows = await rest_get(
        "evaluations_decrypted",
        params={"user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": "20"},
    )

    behaviour_by_answer: dict[str, dict] = {}
    questions_by_id: dict[str, dict] = {}
    if eval_rows:
        answer_ids = {r["answer_id"] for r in eval_rows}
        behaviour_rows = await rest_get(
            "answer_behaviour_decrypted",
            params={"answer_id": f"in.({','.join(answer_ids)})"},
        )
        behaviour_by_answer = {b["answer_id"]: b for b in behaviour_rows}

        question_ids = {r["question_id"] for r in eval_rows}
        question_rows = await rest_get(
            "questions",
            params={"id": f"in.({','.join(question_ids)})", "select": "id,question_type,question_text,difficulty"},
        )
        questions_by_id = {q["id"]: q for q in question_rows}

    return SYSTEM_PROMPT_TEMPLATE.format(
        progress_summary=_format_progress(list(latest_by_topic.values()), topic_names),
        recent_evaluations=_format_evaluations(eval_rows, behaviour_by_answer, questions_by_id),
    )


@router.get("/history", response_model=list[ChatMessageResponse])
async def chat_history(user: Annotated[dict, Depends(get_current_user)]):
    rows = await rest_get(
        "evaluation_chat_history_decrypted",
        params={"user_id": f"eq.{user['id']}", "order": "created_at.asc", "select": "role,content"},
    )
    return [ChatMessageResponse(role=r["role"], content=r["content"]) for r in rows]


@router.post("/chat", response_model=ChatMessageResponse)
async def chat(
    req: ChatMessageRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    history_rows = await rest_get(
        "evaluation_chat_history_decrypted",
        params={"user_id": f"eq.{user['id']}", "order": "created_at.asc", "select": "role,content"},
    )
    messages = [{"role": r["role"], "content": r["content"]} for r in history_rows]
    messages.append({"role": "user", "content": req.content})

    system_prompt = await _build_system_prompt(str(user["id"]))

    client = _get_client()
    response = await client.messages.create(
        model=CLAUDE_CHATBOT_MODEL,
        max_tokens=1536,
        system=system_prompt,
        # Low but not zero — this is explaining/analyzing real numbers (should
        # stay grounded, unlike the goal-chat's 0.7), not a factual lookup
        # with one right phrasing (unlike evaluate_answer's 0.1).
        temperature=0.3,
        output_config={"format": {"type": "json_schema", "schema": CHAT_OUTPUT_SCHEMA}},
        messages=messages,
    )
    raw_text = next(block.text for block in response.content if block.type == "text")
    parsed = json.loads(raw_text)
    reply_text = parsed["reply_text"]
    chart = parsed["chart"] if parsed["chart"]["kind"] != "none" else None

    # Plaintext in — evaluation_chat_history_decrypted's INSTEAD OF INSERT
    # trigger encrypts content. Only reply_text is persisted (not the chart) —
    # keeps the conversation history clean prose for the model's own future
    # context, and charts are a live-session-only visual, not reconstructed
    # from history on page reload.
    await rest_post(
        "evaluation_chat_history_decrypted",
        json=[
            {"user_id": str(user["id"]), "role": "user", "content": req.content},
            {"user_id": str(user["id"]), "role": "assistant", "content": reply_text},
        ],
    )

    return ChatMessageResponse(role="assistant", content=reply_text, chart=chart)
