"""WhatsApp Business Cloud API connector for ManFriday.

Pulls messages from WhatsApp via the Meta Cloud API.

WhatsApp Cloud API docs:
    https://developers.facebook.com/docs/whatsapp/cloud-api
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from shared.python.manfriday_core.secrets import (
    delete_byok_key,
    get_byok_key,
    store_byok_key,
)
from workers.ingest.connectors.base import ConnectorBase, ConnectorItem

logger = logging.getLogger(__name__)

WHATSAPP_API_BASE = "https://graph.facebook.com/v18.0"


class WhatsAppConnector(ConnectorBase):
    """Connector that interacts with the WhatsApp Business Cloud API."""

    CONNECTOR_TYPE = "whatsapp"

    # ------------------------------------------------------------------ #
    #  connect
    # ------------------------------------------------------------------ #
    async def connect(self, user_id: str, credentials: dict[str, Any]) -> bool:
        """Store WhatsApp access token and verify it.

        Args:
            user_id: ManFriday user id.
            credentials: ``{"access_token": "...", "phone_number_id": "..."}``

        Returns:
            True if the credentials are valid, False otherwise.
        """
        access_token: str = credentials.get("access_token", "")
        phone_number_id: str = credentials.get("phone_number_id", "")
        if not access_token or not phone_number_id:
            raise ValueError(
                "credentials must contain 'access_token' and 'phone_number_id'"
            )

        # Verify token by querying the phone number endpoint
        url = f"{WHATSAPP_API_BASE}/{phone_number_id}"
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code != 200:
                logger.warning(
                    "WhatsApp verification failed: %s %s",
                    resp.status_code,
                    resp.text,
                )
                return False
            body = resp.json()
            if "error" in body:
                logger.warning("WhatsApp API error: %s", body["error"])
                return False

        verified_name = body.get("verified_name", body.get("display_phone_number", ""))
        logger.info(
            "WhatsApp phone verified: %s (id=%s)",
            verified_name,
            phone_number_id,
        )

        # Persist credentials as JSON blob
        import json

        payload = json.dumps(
            {"access_token": access_token, "phone_number_id": phone_number_id}
        )
        store_byok_key("whatsapp", user_id, payload)
        return True

    # ------------------------------------------------------------------ #
    #  poll
    # ------------------------------------------------------------------ #
    async def poll(
        self, user_id: str, since: str | None = None
    ) -> list[ConnectorItem]:
        """Fetch new inbound messages via the WhatsApp Cloud API.

        The Cloud API delivers messages via webhooks in real-time.  This
        method queries the ``/{phone_number_id}/messages`` conversation
        analytics endpoint and the webhook-buffered messages stored by
        the ManFriday webhook handler.

        For the polling flow we query the WhatsApp Business Management API
        conversation analytics endpoint to discover recent conversations
        and then retrieve individual messages.

        Args:
            user_id: ManFriday user id.
            since: ISO-8601 timestamp.  Messages before this are skipped.

        Returns:
            List of ``ConnectorItem`` objects.
        """
        import json as _json

        raw = get_byok_key("whatsapp", user_id)
        creds: dict[str, str] = _json.loads(raw)
        access_token = creds["access_token"]
        phone_number_id = creds["phone_number_id"]

        since_dt: datetime | None = None
        if since:
            since_dt = datetime.fromisoformat(since)
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)

        headers = {"Authorization": f"Bearer {access_token}"}
        items: list[ConnectorItem] = []

        # Query conversation analytics to find recent conversations
        # The WhatsApp Business API provides analytics via the
        # /{waba_id}/conversation_analytics endpoint.  For polling we
        # use the messages endpoint with the conversations filter.
        analytics_url = (
            f"{WHATSAPP_API_BASE}/{phone_number_id}/messages"
        )
        params: dict[str, Any] = {"limit": 100}
        if since_dt:
            # Unix timestamp for filtering
            params["since"] = int(since_dt.timestamp())

        async with httpx.AsyncClient(timeout=30) as client:
            # Paginate through results
            url: str | None = analytics_url
            max_pages = 20

            for _ in range(max_pages):
                if url is None:
                    break

                resp = await client.get(url, headers=headers, params=params)
                if resp.status_code != 200:
                    logger.warning(
                        "WhatsApp messages query failed: %s %s",
                        resp.status_code,
                        resp.text,
                    )
                    break

                body = resp.json()
                if "error" in body:
                    logger.error("WhatsApp API error: %s", body["error"])
                    break

                messages: list[dict] = body.get("data", body.get("messages", []))
                for msg in messages:
                    item = self._message_to_item(msg, phone_number_id, since_dt)
                    if item is not None:
                        items.append(item)

                # Follow pagination cursor
                paging = body.get("paging", {})
                url = paging.get("next")
                params = {}  # params are embedded in the next URL

        logger.info(
            "WhatsApp poll for user %s returned %d items", user_id, len(items)
        )
        return items

    # ------------------------------------------------------------------ #
    #  disconnect
    # ------------------------------------------------------------------ #
    async def disconnect(self, user_id: str) -> None:
        """Delete stored WhatsApp credentials from Secret Manager."""
        delete_byok_key("whatsapp", user_id)
        logger.info("WhatsApp connector disconnected for user %s", user_id)

    # ------------------------------------------------------------------ #
    #  Webhook ingestion (called by the FastAPI webhook endpoint)
    # ------------------------------------------------------------------ #
    @staticmethod
    def parse_webhook_payload(payload: dict[str, Any]) -> list[ConnectorItem]:
        """Convert an inbound WhatsApp webhook payload into ConnectorItems.

        This is meant to be called from the API webhook handler for
        real-time message ingestion, complementing the poll() method.

        Args:
            payload: The raw JSON body from the WhatsApp webhook POST.

        Returns:
            List of ``ConnectorItem`` objects extracted from the payload.
        """
        items: list[ConnectorItem] = []

        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                phone_number_id = value.get("metadata", {}).get(
                    "phone_number_id", "unknown"
                )
                contacts = {
                    c.get("wa_id", ""): c.get("profile", {}).get("name", "unknown")
                    for c in value.get("contacts", [])
                }
                for msg in value.get("messages", []):
                    sender_wa_id = msg.get("from", "unknown")
                    sender_name = contacts.get(sender_wa_id, sender_wa_id)
                    msg_id = msg.get("id", "unknown")
                    timestamp = msg.get("timestamp")

                    # Extract text from various message types
                    text = ""
                    msg_type = msg.get("type", "unknown")
                    if msg_type == "text":
                        text = msg.get("text", {}).get("body", "")
                    elif msg_type == "image":
                        text = msg.get("image", {}).get("caption", "[image]")
                    elif msg_type == "video":
                        text = msg.get("video", {}).get("caption", "[video]")
                    elif msg_type == "document":
                        text = msg.get("document", {}).get("caption", "[document]")
                    elif msg_type == "audio":
                        text = "[audio message]"
                    elif msg_type == "location":
                        loc = msg.get("location", {})
                        text = f"[location: {loc.get('latitude')}, {loc.get('longitude')}]"
                    elif msg_type == "contacts":
                        text = "[shared contact]"
                    elif msg_type == "reaction":
                        text = msg.get("reaction", {}).get("emoji", "[reaction]")

                    ts_iso = None
                    if timestamp:
                        ts_iso = datetime.fromtimestamp(
                            int(timestamp), tz=timezone.utc
                        ).isoformat()

                    items.append(
                        ConnectorItem(
                            source_url=f"whatsapp://{msg_id}",
                            source_type="whatsapp",
                            title=f"WhatsApp: {sender_name}",
                            raw_content=text if text else None,
                            metadata={
                                "chat_id": sender_wa_id,
                                "sender": sender_name,
                                "message_type": msg_type,
                                "phone_number_id": phone_number_id,
                                "timestamp": ts_iso,
                            },
                        )
                    )

        return items

    # ------------------------------------------------------------------ #
    #  helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _message_to_item(
        msg: dict[str, Any],
        phone_number_id: str,
        since_dt: datetime | None,
    ) -> ConnectorItem | None:
        """Convert a single message dict to a ConnectorItem."""
        timestamp = msg.get("timestamp")
        if timestamp and since_dt:
            try:
                msg_dt = datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
                if msg_dt < since_dt:
                    return None
            except (ValueError, TypeError):
                pass

        msg_id = msg.get("id", "unknown")
        sender = msg.get("from", msg.get("sender", "unknown"))
        text = ""

        msg_type = msg.get("type", "text")
        if msg_type == "text":
            text = msg.get("text", {}).get("body", "") if isinstance(msg.get("text"), dict) else str(msg.get("text", ""))
        elif msg_type in ("image", "video", "document"):
            text = msg.get(msg_type, {}).get("caption", f"[{msg_type}]")
        elif msg_type == "audio":
            text = "[audio message]"
        else:
            text = msg.get("body", str(msg.get("text", "")))

        ts_iso = None
        if timestamp:
            try:
                ts_iso = datetime.fromtimestamp(
                    int(timestamp), tz=timezone.utc
                ).isoformat()
            except (ValueError, TypeError):
                ts_iso = str(timestamp)

        return ConnectorItem(
            source_url=f"whatsapp://{msg_id}",
            source_type="whatsapp",
            title=f"WhatsApp: {sender}",
            raw_content=text if text else None,
            metadata={
                "chat_id": sender,
                "sender": sender,
                "phone_number_id": phone_number_id,
                "timestamp": ts_iso,
            },
        )
