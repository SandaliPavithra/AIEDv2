import logging
import sys
import time
import uuid
from contextvars import ContextVar

from starlette.datastructures import MutableHeaders

from app.log_stream import BroadcastHandler

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        import json as _json

        payload = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": request_id_var.get("-"),
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return _json.dumps(payload)


def setup_logging() -> None:
    """Configure structured JSON logging for the application."""

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    broadcast_handler = BroadcastHandler()
    broadcast_handler.setFormatter(JsonFormatter())

    # Replace any existing handlers
    root.handlers.clear()
    root.addHandler(handler)
    root.addHandler(broadcast_handler)

    # Silence noisy libraries
    for noisy in ("uvicorn.access", "uvicorn.error", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


logger = logging.getLogger("aied")


class RequestLoggingMiddleware:
    """Pure ASGI middleware — deliberately NOT Starlette's BaseHTTPMiddleware.

    BaseHTTPMiddleware buffers/bridges the downstream response through an
    internal task group, which has a well-documented deadlock risk with
    long-lived streaming responses (exactly what GET /logs/stream is): while
    that SSE connection is open, every other request on the same process can
    hang indefinitely, including endpoints as simple as /health. Wrapping
    `send` directly avoids that bridging entirely — this middleware never
    buffers or waits on the response body, streaming or not.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        rid = str(uuid.uuid4())[:8]
        request_id_var.set(rid)
        method = scope["method"]
        path = scope["path"]
        start = time.perf_counter()
        status_code = 500

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = rid
                headers["X-Response-Time-Ms"] = str(elapsed_ms)
            await send(message)

        await self.app(scope, receive, send_wrapper)

        elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
        if path != "/health":
            logger.info(
                "%s %s %d %.1fms",
                method, path, status_code, elapsed_ms,
                extra={"method": method, "path": path, "status": status_code, "ms": elapsed_ms},
            )
