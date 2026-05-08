from datetime import datetime


def compute_behaviour(
    events: list[dict],
    expected_time_seconds: int,
) -> dict:
    if not events:
        return {
            "active_time_seconds": 0,
            "total_elapsed_seconds": 0,
            "pause_count": 0,
            "distraction_ratio": 0.0,
            "answer_start_delay_seconds": 0,
            "revision_count": 0,
            "behaviour_label": "neutral",
            "time_modifier": 1.0,
        }

    events_sorted = sorted(events, key=lambda e: e["event_at"])
    first_event = events_sorted[0]["event_at"]
    last_event = events_sorted[-1]["event_at"]

    total_elapsed = int((last_event - first_event).total_seconds())

    # Compute active time (time with focus)
    active_time = 0
    blur_time = 0
    focus_start: datetime | None = None
    blur_start: datetime | None = None
    pause_count = 0

    for ev in events_sorted:
        etype = ev["event_type"]
        eat = ev["event_at"]
        if etype == "focus":
            if blur_start is not None:
                blur_time += int((eat - blur_start).total_seconds())
                blur_start = None
            if focus_start is None:
                if pause_count > 0:
                    pass
                focus_start = eat
            else:
                pause_count += 1
                focus_start = eat
        elif etype == "blur":
            if focus_start is not None:
                active_time += int((eat - focus_start).total_seconds())
                focus_start = None
            blur_start = eat
            pause_count += 1

    if focus_start is not None:
        active_time += int((last_event - focus_start).total_seconds())

    # Answer start delay: gap between first focus and first keystroke
    first_focus = next((e["event_at"] for e in events_sorted if e["event_type"] == "focus"), None)
    first_keystroke = next(
        (e["event_at"] for e in events_sorted if e["event_type"] == "keystroke_start"), None
    )
    if first_focus and first_keystroke:
        answer_start_delay = max(0, int((first_keystroke - first_focus).total_seconds()))
    else:
        answer_start_delay = 0

    # Revision count: number of edit events
    revision_count = sum(1 for e in events_sorted if e["event_type"] == "edit")

    distraction_ratio = round(blur_time / total_elapsed, 3) if total_elapsed > 0 else 0.0

    # Behaviour label (pure rules, no AI)
    if distraction_ratio > 0.5:
        label = "distracted"
    elif pause_count > 5 and revision_count > 3:
        label = "struggling"
    elif answer_start_delay > 60 and revision_count < 2:
        label = "guessing"
    elif active_time >= expected_time_seconds * 0.8 and revision_count > 1:
        label = "confident"
    else:
        label = "neutral"

    # Time modifier
    expected_minutes = expected_time_seconds / 60
    active_minutes = active_time / 60
    time_modifier = max(0.70, 1.0 - (0.1 * max(0, active_minutes - expected_minutes)))

    if label == "distracted":
        time_modifier = round(time_modifier * 0.95, 3)
    elif label == "guessing":
        time_modifier = round(time_modifier * 0.90, 3)
    else:
        time_modifier = round(time_modifier, 3)

    return {
        "active_time_seconds": active_time,
        "total_elapsed_seconds": total_elapsed,
        "pause_count": pause_count,
        "distraction_ratio": distraction_ratio,
        "answer_start_delay_seconds": answer_start_delay,
        "revision_count": revision_count,
        "behaviour_label": label,
        "time_modifier": time_modifier,
    }
