"""arXiv connector — STUB (paid tier)."""

from __future__ import annotations

from typing import Any

from workers.ingest.connectors.base import ConnectorBase, ConnectorItem


class ArxivConnector(ConnectorBase):
    CONNECTOR_TYPE = "arxiv"

    async def connect(self, user_id: str, credentials: dict[str, Any]) -> bool:
        raise NotImplementedError("arXiv connector is paid tier")

    async def poll(self, user_id: str, since: str | None = None) -> list[ConnectorItem]:
        raise NotImplementedError("arXiv connector is paid tier")

    async def disconnect(self, user_id: str) -> None:
        raise NotImplementedError("arXiv connector is paid tier")
