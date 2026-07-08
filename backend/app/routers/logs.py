import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.auth import require_admin
from app.log_stream import subscribe, unsubscribe

router = APIRouter()


@router.get("/stream")
async def stream_logs(
    request: Request,
    admin: Annotated[dict, Depends(require_admin)],
):
    """Admin-only live tail of the backend's log output, as Server-Sent Events."""

    async def event_gen():
        queue = subscribe()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    line = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {line}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            unsubscribe(queue)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
