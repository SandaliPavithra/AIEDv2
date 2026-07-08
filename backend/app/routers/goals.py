import json
from typing import Annotated

from fastapi import APIRouter, Depends

from anthropic import AsyncAnthropic

from app.auth import get_current_user
from app.config import CLAUDE_CHATBOT_MODEL, settings
from app.models.progress import ChatMessageRequest, ChatMessageResponse, GoalResponse
from app.supabase_rest import rest_get, rest_post

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

_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


@router.get("/", response_model=list[GoalResponse])
async def list_goals(user: Annotated[dict, Depends(get_current_user)]):
    rows = await rest_get(
        "student_goals_decrypted",
        params={"user_id": f"eq.{user['id']}", "status": "eq.active", "order": "created_at.desc"},
    )
    return [GoalResponse(**r) for r in rows]


@router.get("/history", response_model=list[ChatMessageResponse])
async def chat_history(user: Annotated[dict, Depends(get_current_user)]):
    rows = await rest_get(
        "goal_chat_history_decrypted",
        params={"user_id": f"eq.{user['id']}", "order": "created_at.asc", "select": "role,content"},
    )
    return [ChatMessageResponse(role=r["role"], content=r["content"]) for r in rows]


@router.post("/chat", response_model=ChatMessageResponse)
async def chat(
    req: ChatMessageRequest,
    user: Annotated[dict, Depends(get_current_user)],
):
    history_rows = await rest_get(
        "goal_chat_history_decrypted",
        params={"user_id": f"eq.{user['id']}", "order": "created_at.asc", "select": "role,content"},
    )

    messages = [{"role": r["role"], "content": r["content"]} for r in history_rows]
    messages.append({"role": "user", "content": req.content})

    client = _get_client()
    response = await client.messages.create(
        model=CLAUDE_CHATBOT_MODEL,
        max_tokens=512,
        system=GOAL_SYSTEM_PROMPT,
        temperature=0.7,
        messages=messages,
    )

    assistant_text = next(block.text for block in response.content if block.type == "text")

    # Plaintext in — goal_chat_history_decrypted's INSTEAD OF INSERT trigger
    # encrypts content. Bulk insert: the trigger fires once per row (FOR EACH ROW).
    await rest_post(
        "goal_chat_history_decrypted",
        json=[
            {"user_id": str(user["id"]), "role": "user", "content": req.content},
            {"user_id": str(user["id"]), "role": "assistant", "content": assistant_text},
        ],
    )

    # Extract goal if present
    if "```goal" in assistant_text:
        try:
            goal_json_str = assistant_text.split("```goal")[1].split("```")[0].strip()
            goal_data = json.loads(goal_json_str)
            await rest_post(
                "student_goals_decrypted",
                json={
                    "user_id": str(user["id"]),
                    "goal_text": f"Goal: {goal_data.get('topic', '')} — target {goal_data.get('target_score', '')}",
                    "goal_structured": goal_data,
                    "status": "active",
                },
            )
        except (json.JSONDecodeError, IndexError):
            pass

    return ChatMessageResponse(role="assistant", content=assistant_text)
