"""Shared fixtures for ManFriday tests.

Rules:
- All external services are mocked with unittest.mock.MagicMock.
- No real network calls, no real credentials, no real databases.
"""

from __future__ import annotations

from unittest.mock import MagicMock
import pytest


@pytest.fixture
def fake_gcs():
    """A fake GCS client that stores blobs in memory."""
    store: dict = {}
    bucket = MagicMock()

    def _blob(path: str):
        b = MagicMock()
        b.download_as_text.side_effect = lambda: store[path].decode()
        b.download_as_bytes.side_effect = lambda: store[path]
        b.exists.return_value = path in store

        def _upload(data, content_type=None):
            store[path] = data.encode() if isinstance(data, str) else data

        b.upload_from_string.side_effect = _upload
        b.delete.side_effect = lambda: store.pop(path, None)
        return b

    bucket.blob.side_effect = _blob
    bucket.list_blobs.return_value = []
    return bucket


@pytest.fixture
def mock_llm_response():
    """A deterministic LLM response object."""
    resp = MagicMock()
    resp.content = "# Mock Wiki Article\n\nThis is a mock LLM response."
    resp.model = "claude-sonnet-4-20250514"
    resp.provider = "anthropic"
    resp.usage = {"input_tokens": 10, "output_tokens": 20}
    resp.tool_calls = []
    return resp


@pytest.fixture
def mock_llm(mock_llm_response):
    """Async callable that replaces shared.python.manfriday_core.llm.call."""
    async def _call(*args, **kwargs):
        return mock_llm_response
    return _call


@pytest.fixture
def user_id() -> str:
    """A stable test user ID -- never hits a real auth system."""
    return "test-user-00000000"
