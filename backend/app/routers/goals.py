import json
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.config import EVALUATION_CONFIG, SONNET_MODEL, settings
from app.database import get_pool
from app.models.progress import ChatMessageRequest, ChatMessageResponse, GoalResponse

import anthropic

router = APIRouter()

GOAL_SYSTEM_PROMPT = """You are a friendly academic goal-setting assistant for an AI/ML education platform.
Help students articulate specific, measurable learning goals.
Ask clarifying questions about: what topic they want to master, target score, exam deadline, and how much time they can commit.
Keep responses concise (2-4 sentences).
When you identify a clear goal, output it as a JSON block at the end of your response:
```goal
{"type": "exam_pass", "topic": "Neural Networks", "target_score": 80, "deadline": "2025-06-01"}
```
Only include the JSON block when a complete goal has been articulated."""

_client: anthropic.AsyncAnthropic | None = None


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


@router.get("/", response_model=list[GoalResponse])
async def list_goals(user: Annotated[dict, Depends(get_current_user)]):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM student_goals WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC",
            user["id"],
        )
    result = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("goal_structured"), str):
            d["goal_structured"] = json.loads(d["goal_structured"])
        result.append(GoalResponse(**d))
    return result


@router.get("/history", response_model=list[ChatMessageResponse])
async def chat_history(user: Annotated[dict, Depends(get_current_user)]):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT role, content FROM goal_chat_history WHERE user_id = $1 ORDER BY created_at",
            user["id"],
        )
    return [ChatMessageResponse(role=r["role"], content=r["content"]) for r in rows]


@router.post("/chat", response_model=ChatMessageResponse)
async def chat(
    req: ChatMessageRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        history_rows = await conn.fetch(
            "SELECT role, content FROM goal_chat_history WHERE user_id = $1 ORDER BY created_at",
            user["id"],
        )

    messages = [{"role": r["role"], "content": r["content"]} for r in history_rows]
    messages.append({"role": "user", "content": req.content})

    client = _get_client()
    response = await client.messages.create(
        model=SONNET_MODEL,
        max_tokens=512,
        temperature=0.7,
        system=[
            {
                "type": "text",
                "text": GOAL_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=messages,
    )

    assistant_text = response.content[0].text

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO goal_chat_history (id, user_id, role, content, created_at) VALUES (gen_random_uuid(),$1,'user',$2,now())",
            user["id"], req.content,
        )
        await conn.execute(
            "INSERT INTO goal_chat_history (id, user_id, role, content, created_at) VALUES (gen_random_uuid(),$1,'assistant',$2,now())",
            user["id"], assistant_text,
        )

        # Extract goal if present
        if "```goal" in assistant_text:
            try:
                goal_json_str = assistant_text.split("```goal")[1].split("```")[0].strip()
                goal_data = json.loads(goal_json_str)
                await conn.execute(
                    """
                    INSERT INTO student_goals
                      (id, user_id, goal_text, goal_structured, status, created_at, updated_at)
                    VALUES (gen_random_uuid(),$1,$2,$3::jsonb,'active',now(),now())
                    """,
                    user["id"],
                    f"Goal: {goal_data.get('topic', '')} — target {goal_data.get('target_score', '')}",
                    json.dumps(goal_data),
                )
            except (json.JSONDecodeError, IndexError):
                pass

    return ChatMessageResponse(role="assistant", content=assistant_text)
