"""WhatsApp connector — STUB (Phase II)."""

from __future__ import annotations

from typing import Any

from workers.ingest.connectors.base import ConnectorBase, ConnectorItem


class WhatsAppConnector(ConnectorBase):
    CONNECTOR_TYPE = "whatsapp"

    async def connect(self, user_id: str, credentials: dict[str, Any]) -> bool:
        raise NotImplementedError("WhatsApp connector is Phase II")

    async def poll(self, user_id: str, since: str | None = None) -> list[ConnectorItem]:
        raise NotImplementedError("WhatsApp connector is Phase II")

    async def disconnect(self, user_id: str) -> None:
        raise NotImplementedError("WhatsApp connector is Phase II")
