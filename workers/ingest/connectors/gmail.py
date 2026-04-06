"""Gmail connector — STUB (Phase II)."""

from __future__ import annotations

from typing import Any

from workers.ingest.connectors.base import ConnectorBase, ConnectorItem


class GmailConnector(ConnectorBase):
    CONNECTOR_TYPE = "gmail"

    async def connect(self, user_id: str, credentials: dict[str, Any]) -> bool:
        raise NotImplementedError("Gmail connector is Phase II")

    async def poll(self, user_id: str, since: str | None = None) -> list[ConnectorItem]:
        raise NotImplementedError("Gmail connector is Phase II")

    async def disconnect(self, user_id: str) -> None:
        raise NotImplementedError("Gmail connector is Phase II")
