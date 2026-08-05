import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from anthropic import AsyncAnthropic

from app.auth import get_current_user
from app.config import CLAUDE_EVALUATION_MODEL, settings
from app.logging_config import logger
from app.models.deep_evaluation import (
    DeepEvaluationReportResponse,
    DeepEvaluationReportSummary,
    GenerateReportRequest,
)
from app.supabase_rest import rest_get, rest_get_one, rest_post_one

router = APIRouter()

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


# Structured output, not free-text parsing — same json_schema pattern as
# evaluation.py/generation.py/the old evaluation_chat.py. Five required
# sections instead of the old {reply_text, chart}: this is a full report,
# not a chat reply, and gets rendered as a full-UI 60/30/10 layout, not a
# bubble.
DEEP_EVAL_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "analysis": {"type": "string"},
        "justification": {"type": "string"},
        "predictions": {"type": "string"},
        "diagrams": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["line", "bar", "radar"]},
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
    },
    "required": ["summary", "analysis", "justification", "predictions", "diagrams"],
    "additionalProperties": False,
}


# How many recent evaluations feed the report — deliberately much larger than
# the old chat's 20: a "deep" report is expected to show real trends across
# weeks of history, not just the last handful of answers.
_RECENT_EVALUATIONS_LIMIT = 50


SYSTEM_PROMPT_TEMPLATE = """You are an academic evaluation analyst for an AI/ML education platform, generating a \
full deep-evaluation report — not a quick chat reply. Every number below was already produced by a deterministic \
pipeline before this request started — you are interpreting it, not scoring or judging the student yourself, and \
never inventing a score, trend, or behaviour that isn't in the data below.

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
of questions this student performs best and worst on, as a direct finding, whenever the data supports it.

Student's per-topic progress (latest snapshot per topic — note these averages blend MCQ correctness with
free-text depth-of-understanding scores; caveat this if it matters to your answer):
{progress_summary}

Student's most recently evaluated answers, each with its question text, difficulty, and behavioural/timing
data (newest first):
{recent_evaluations}

You are producing FOUR distinct written sections plus a set of diagrams. Respond as JSON:
{{"summary": "...", "analysis": "...", "justification": "...", "predictions": "...", "diagrams": [...]}}

- summary (~10% of the report, read first): 2-3 sentences, the single bottom-line verdict — are they doing
  well, and on what basis. No hedging filler; commit to the clearest supported statement.
- analysis (~30% of the report, section 1 of 3 — the "what"): assess concept mastery (what's actually
  understood vs. missing, using concepts_missed), communication quality (using wording, correctly per the
  rubric note above), and what kind of questions this student is actually strong/weak at (per the
  cognitive-demand instruction above).
- justification (~30% of the report, section 2 of 3 — the "why"): for each major finding in analysis, cite
  the specific evidence (which answers/dates/scores) that supports it, and directly address alternative
  explanations before ruling them out (an MCQ-vs-free-text format gap, a harder question, one bad day vs. a
  real pattern). Do not just restate analysis in different words — make a skeptical reader believe it.
- predictions (~30% of the report, section 3 of 3 — the "what next"): commit to a specific, evidence-based
  projection (which concepts will keep being missed if unaddressed, whether the current trend continues, what
  the next few answers are likely to look like if nothing changes) and specific, actionable next steps tied to
  the actual evidence (name the concept to re-study, the behavioural pattern to change and how) — never generic
  advice like "practice more" or "focus better."
- diagrams: 2-6 charts that make analysis/justification/predictions concrete. Prefer a genuine mix — e.g. a
  score-over-time line chart, a per-dimension bar or radar breakdown (radar suits comparing 4-5 dimensions of
  one period at a glance), a behaviour-pattern breakdown — rather than defaulting to one chart type. kind is
  "line" (ordered sequence, e.g. scores over time), "bar" (discrete categories), or "radar" (multiple
  dimensions of a single subject compared at once). x_labels are the real labels behind each point (dates,
  dimension names, behaviour labels — never invented); series is 1-3 entries, each a short "name" and a
  "values" array the exact same length as x_labels (for radar, one value per axis/x_label), every number
  copied directly from the data above, never estimated. Cap each diagram at 3 series and 8 x_labels; cap the
  whole report at 6 diagrams — pick the most relevant angles for this request rather than cramming in
  everything.

Ground every section in the specific request below — answer what was actually asked, using the full data
above, not a generic template response. Short paragraphs, not a wall of stats; Markdown bold/bullets are fine,
they render.

Student's request: {question}"""


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


async def _build_system_prompt(user_id: str, question: str) -> str:
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
        params={"user_id": f"eq.{user_id}", "order": "created_at.desc", "limit": str(_RECENT_EVALUATIONS_LIMIT)},
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
        question=question,
    )


@router.get("/reports", response_model=list[DeepEvaluationReportSummary])
async def list_reports(user: Annotated[dict, Depends(get_current_user)]):
    rows = await rest_get(
        "deep_evaluation_reports_decrypted",
        params={
            "user_id": f"eq.{user['id']}",
            "order": "created_at.desc",
            "select": "id,question_text,summary,created_at",
            "limit": "50",
        },
    )
    return [DeepEvaluationReportSummary(**r) for r in rows]


@router.get("/reports/{report_id}", response_model=DeepEvaluationReportResponse)
async def get_report(
    report_id: uuid.UUID,
    user: Annotated[dict, Depends(get_current_user)],
):
    row = await rest_get_one(
        "deep_evaluation_reports_decrypted",
        params={"id": f"eq.{report_id}", "user_id": f"eq.{user['id']}"},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    return DeepEvaluationReportResponse(**row)


@router.post("/generate", response_model=DeepEvaluationReportResponse)
async def generate_report(
    req: GenerateReportRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    system_prompt = await _build_system_prompt(str(user["id"]), req.question)

    client = _get_client()
    response = await client.messages.create(
        model=CLAUDE_EVALUATION_MODEL,
        # A full 4-section report + up to 6 diagrams over 50 evaluations is
        # much larger output than the old one-paragraph-plus-one-chart chat
        # reply — 6144 truncated before producing a single complete content
        # block (stop_reason="max_tokens", zero "text" blocks). Headroom.
        max_tokens=16000,
        system=system_prompt,
        # claude-sonnet-5 rejects temperature/top_p entirely with structured
        # output (see evaluation.py's evaluate_answer for the same fix) — no
        # equivalent knob to pass here.
        output_config={"format": {"type": "json_schema", "schema": DEEP_EVAL_OUTPUT_SCHEMA}},
        messages=[{"role": "user", "content": req.question}],
    )

    text_block = next((block for block in response.content if block.type == "text"), None)
    if text_block is None:
        logger.error(
            "[deep_evaluation.py] No text block in Claude response — stop_reason=%r, content types=%r",
            response.stop_reason, [b.type for b in response.content],
        )
        raise HTTPException(
            status_code=502,
            detail="Report generation was cut off before completing. Try a shorter/more specific question.",
        )
    parsed = json.loads(text_block.text)

    # Plaintext in — deep_evaluation_reports_decrypted's INSTEAD OF INSERT
    # trigger encrypts question_text/summary/analysis/justification/predictions.
    # diagrams is stored as-is (plaintext JSONB, not PII).
    row = await rest_post_one(
        "deep_evaluation_reports_decrypted",
        json={
            "user_id": str(user["id"]),
            "question_text": req.question,
            "summary": parsed["summary"],
            "analysis": parsed["analysis"],
            "justification": parsed["justification"],
            "predictions": parsed["predictions"],
            "diagrams": parsed["diagrams"],
            "model_used": CLAUDE_EVALUATION_MODEL,
        },
    )
    return DeepEvaluationReportResponse(**row)
