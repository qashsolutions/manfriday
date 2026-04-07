"""Security middleware — log redaction, CSP headers, rate limiting.

Ensures BYOK API keys are never leaked through logs, responses, or headers.
"""

from __future__ import annotations

import logging
import re
import time
from collections import defaultdict
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


# ---------------------------------------------------------------------------
# 1. Log redaction filter — strips API key patterns from all log output
# ---------------------------------------------------------------------------

class KeyRedactingFilter(logging.Filter):
    """Redact API key patterns from log messages before they reach any handler."""

    PATTERNS = [
        re.compile(r"sk-ant-\S+"),       # Anthropic keys
        re.compile(r"sk-proj-\S+"),       # OpenAI project keys
        re.compile(r"sk-\S{20,}"),        # Generic OpenAI / long sk- keys
        re.compile(r"AIza\S+"),           # Google / Gemini keys
        re.compile(r"GOCSPX-\S+"),        # Google OAuth client secrets
        re.compile(r"xai-\S+"),           # xAI keys
    ]

    REPLACEMENT = "[REDACTED_KEY]"

    def filter(self, record: logging.LogRecord) -> bool:
        if record.msg and isinstance(record.msg, str):
            for pat in self.PATTERNS:
                record.msg = pat.sub(self.REPLACEMENT, record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    k: pat.sub(self.REPLACEMENT, str(v)) if isinstance(v, str) else v
                    for k, v in record.args.items()
                    for pat in self.PATTERNS
                }
            elif isinstance(record.args, tuple):
                new_args = []
                for arg in record.args:
                    if isinstance(arg, str):
                        for pat in self.PATTERNS:
                            arg = pat.sub(self.REPLACEMENT, arg)
                    new_args.append(arg)
                record.args = tuple(new_args)
        return True


def install_log_redaction() -> None:
    """Attach the KeyRedactingFilter to the root logger so all log output is scrubbed."""
    root_logger = logging.getLogger()
    # Avoid double-install
    if not any(isinstance(f, KeyRedactingFilter) for f in root_logger.filters):
        root_logger.addFilter(KeyRedactingFilter())


# ---------------------------------------------------------------------------
# 2. CSP headers middleware
# ---------------------------------------------------------------------------

class CSPHeadersMiddleware(BaseHTTPMiddleware):
    """Add Content-Security-Policy and other security headers to every response."""

    CSP = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self'; "
        "connect-src 'self' https://manfriday-api-*.run.app https://*.supabase.co; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = self.CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


# ---------------------------------------------------------------------------
# 3. Rate limiter for sensitive endpoints (e.g. validate-key)
# ---------------------------------------------------------------------------

class RateLimitExceeded(Exception):
    """Raised when a user exceeds the rate limit."""
    pass


class InMemoryRateLimiter:
    """Simple sliding-window rate limiter keyed by user_id.

    Parameters
    ----------
    max_calls : int
        Maximum number of calls allowed within the window.
    window_seconds : int
        Length of the sliding window in seconds.
    """

    def __init__(self, max_calls: int = 5, window_seconds: int = 60):
        self.max_calls = max_calls
        self.window_seconds = window_seconds
        # user_id -> list of timestamps
        self._calls: dict[str, list[float]] = defaultdict(list)

    def check(self, user_id: str) -> None:
        """Check rate limit for a user. Raises RateLimitExceeded if over limit."""
        now = time.monotonic()
        cutoff = now - self.window_seconds

        # Prune old entries
        self._calls[user_id] = [t for t in self._calls[user_id] if t > cutoff]

        if len(self._calls[user_id]) >= self.max_calls:
            raise RateLimitExceeded(
                f"Rate limit exceeded: max {self.max_calls} calls per {self.window_seconds}s"
            )

        self._calls[user_id].append(now)


# Singleton rate limiter for the validate-key endpoint: 5 calls/minute/user
validate_key_limiter = InMemoryRateLimiter(max_calls=5, window_seconds=60)
