import asyncio
import logging

_subscribers: set[asyncio.Queue] = set()


class BroadcastHandler(logging.Handler):
    """Fans out every formatted log line to whatever's currently subscribed
    (the /logs/stream SSE endpoint). Never blocks or raises: a full queue
    just drops the line rather than backing up the app."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
        except Exception:
            return
        for q in list(_subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)
