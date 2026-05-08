def compute_scores(
    factual_correctness: float,
    structure: float,
    precision: float,
    recall: float,
    wording: float,
    time_modifier: float,
) -> dict:
    accuracy = (factual_correctness * 0.70) + (structure * 0.30)
    raw_score = (
        (accuracy * 0.35)
        + (recall * 0.30)
        + (precision * 0.20)
        + (wording * 0.15)
    )
    final_score = round(raw_score * time_modifier, 2)

    return {
        "accuracy_score": round(accuracy, 2),
        "raw_score": round(raw_score, 2),
        "final_score": final_score,
    }
