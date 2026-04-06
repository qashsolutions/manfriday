"""Base class for external connectors (Phase II).

Connectors pull items from external services (Gmail, Drive, Telegram, etc.)
and enqueue them as ingest jobs.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class ConnectorItem:
    """A single item discovered by a connector."""

    source_url: str
    source_type: str
    title: str
    raw_content: str | None = None
    metadata: dict[str, Any] | None = None


class ConnectorBase(ABC):
    """Abstract base for external service connectors."""

    CONNECTOR_TYPE: str = "unknown"

    @abstractmethod
    async def connect(self, user_id: str, credentials: dict[str, Any]) -> bool:
        """Establish connection to external service. Returns True if successful."""
        ...

    @abstractmethod
    async def poll(self, user_id: str, since: str | None = None) -> list[ConnectorItem]:
        """Poll for new items since last check. Returns list of items to ingest."""
        ...

    @abstractmethod
    async def disconnect(self, user_id: str) -> None:
        """Disconnect from external service."""
        ...
