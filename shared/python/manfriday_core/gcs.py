"""GCS client for ManFriday — all storage operations go through here.

Supports both real GCS and fake-gcs-server for local dev.
"""

from __future__ import annotations

import json
import os
from typing import Any

from google.cloud import storage

BUCKET_NAME = os.getenv("GCS_BUCKET", "manfriday-kb")
GCS_ENDPOINT = os.getenv("GCS_ENDPOINT")  # set for local dev (fake-gcs-server)


def _client() -> storage.Client:
    if GCS_ENDPOINT:
        return storage.Client(
            project="manfriday-dev",
            credentials=None,  # anonymous for fake-gcs
            client_options={"api_endpoint": GCS_ENDPOINT},
        )
    return storage.Client()


def _bucket() -> storage.Bucket:
    return _client().bucket(BUCKET_NAME)


# ── Read ───────────────────────────────────────────────────


def read_text(path: str) -> str:
    """Read a text file from GCS. Raises google.cloud.exceptions.NotFound."""
    blob = _bucket().blob(path)
    return blob.download_as_text()


def read_json(path: str) -> Any:
    return json.loads(read_text(path))


def read_bytes(path: str) -> bytes:
    blob = _bucket().blob(path)
    return blob.download_as_bytes()


def exists(path: str) -> bool:
    return _bucket().blob(path).exists()


# ── Write ──────────────────────────────────────────────────


def write_text(path: str, content: str, content_type: str = "text/plain") -> None:
    blob = _bucket().blob(path)
    blob.upload_from_string(content, content_type=content_type)


def write_json(path: str, data: Any) -> None:
    write_text(path, json.dumps(data, indent=2, default=str), "application/json")


def write_bytes(path: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    blob = _bucket().blob(path)
    blob.upload_from_string(data, content_type=content_type)


# ── List ───────────────────────────────────────────────────


def list_blobs(prefix: str, delimiter: str | None = None) -> list[str]:
    """List blob names under prefix."""
    blobs = _bucket().list_blobs(prefix=prefix, delimiter=delimiter)
    return [b.name for b in blobs]


def list_markdown_files(prefix: str) -> list[str]:
    """List all .md files under prefix."""
    return [p for p in list_blobs(prefix) if p.endswith(".md")]


# ── Delete ─────────────────────────────────────────────────


def delete(path: str) -> None:
    _bucket().blob(path).delete()


# ── Helpers ────────────────────────────────────────────────


def user_path(user_id: str, *parts: str) -> str:
    """Build a GCS path: {user_id}/part1/part2/..."""
    return "/".join([user_id, *parts])
