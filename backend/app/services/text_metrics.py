"""Deterministic, non-AI scoring dimensions computed directly from answer
text — no model call, so these carry zero marginal API cost per answer.
Kept separate from scoring.py (which only combines already-produced scores)
and evaluation.py (which only talks to the AI evaluator)."""

# Expected word count ceiling per question_type/difficulty. Conciseness
# measures brevity of expression, not completeness — an answer that's too
# SHORT to cover the material is already penalised by recall_score, so this
# only penalises going past a reasonable upper bound, never being short.
_EXPECTED_MAX_WORDS = {
    "short_answer": {"easy": 40, "medium": 50, "hard": 60},
    "long_answer": {"easy": 120, "medium": 160, "hard": 200},
}

# A verbatim run of this many consecutive words is a strong signal of direct
# copying rather than coincidental phrase overlap (e.g. shared technical
# terms). Shorter windows (3-4 words) flag too many innocent matches.
_COPY_NGRAM_SIZE = 8

# Below this many words there's no meaningful 8-word run to test at all —
# score as "not enough text to assess" rather than a misleading 0.
_MIN_WORDS_FOR_COPY_CHECK = _COPY_NGRAM_SIZE


def compute_conciseness_score(answer_text: str, question_type: str, difficulty: str) -> float | None:
    """100 = within the expected length; tapers off the more it overshoots.
    None for MCQ — a selected option's text isn't a "conciseness" question."""
    if question_type not in _EXPECTED_MAX_WORDS:
        return None

    word_count = len(answer_text.split())
    if word_count == 0:
        return None

    expected_max = _EXPECTED_MAX_WORDS[question_type].get(
        difficulty, _EXPECTED_MAX_WORDS[question_type]["medium"]
    )
    if word_count <= expected_max:
        return 100.0

    overshoot_ratio = (word_count - expected_max) / expected_max
    return round(max(0.0, 100.0 * (1 - overshoot_ratio)), 2)


def _ngrams(text: str, n: int) -> set[tuple[str, ...]]:
    words = text.lower().split()
    if len(words) < n:
        return set()
    return {tuple(words[i : i + n]) for i in range(len(words) - n + 1)}


def compute_copy_similarity_score(answer_text: str, source_chunk: str, question_type: str) -> float | None:
    """Percentage of the answer's own 8-word runs that also appear verbatim
    in the source chunk — a containment measure, not symmetric similarity,
    since a copied sentence is a small fraction of an 800-1000 token chunk.
    None for MCQ — a selected option is copied by construction."""
    if question_type not in _EXPECTED_MAX_WORDS:
        return None

    answer_ngrams = _ngrams(answer_text, _COPY_NGRAM_SIZE)
    if not answer_ngrams:
        return None

    chunk_ngrams = _ngrams(source_chunk, _COPY_NGRAM_SIZE)
    overlap = len(answer_ngrams & chunk_ngrams)
    return round(100.0 * overlap / len(answer_ngrams), 2)
