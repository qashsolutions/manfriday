"""Telegram Bot API connector for ManFriday.

Pulls messages from Telegram chats via the Bot API.
Requires a bot token obtained from @BotFather.

Telegram Bot API docs: https://core.telegram.org/bots/api
"""

from __future__ import annotations

import json
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

TELEGRAM_API_BASE = "https://api.telegram.org/bot{token}"


class TelegramConnector(ConnectorBase):
    """Connector that polls Telegram chats via Bot API getUpdates."""

    CONNECTOR_TYPE = "telegram"

    # ------------------------------------------------------------------ #
    #  connect
    # ------------------------------------------------------------------ #
    async def connect(self, user_id: str, credentials: dict[str, Any]) -> bool:
        """Store bot token in Secret Manager and verify it with getMe.

        Args:
            user_id: ManFriday user id.
            credentials: ``{"bot_token": "<token from @BotFather>"}``

        Returns:
            True if the token is valid, False otherwise.
        """
        bot_token: str = credentials.get("bot_token", "")
        if not bot_token:
            raise ValueError("credentials must contain 'bot_token'")

        # Verify the token against Telegram
        base_url = TELEGRAM_API_BASE.format(token=bot_token)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{base_url}/getMe")
            if resp.status_code != 200:
                logger.warning("Telegram getMe failed: %s %s", resp.status_code, resp.text)
                return False
            body = resp.json()
            if not body.get("ok"):
                logger.warning("Telegram getMe returned ok=false: %s", body)
                return False

        bot_info = body.get("result", {})
        logger.info(
            "Telegram bot verified: @%s (id=%s)",
            bot_info.get("username"),
            bot_info.get("id"),
        )

        # Persist token
        store_byok_key("telegram", user_id, bot_token)
        return True

    # ------------------------------------------------------------------ #
    #  poll
    # ------------------------------------------------------------------ #
    async def poll(
        self, user_id: str, since: str | None = None
    ) -> list[ConnectorItem]:
        """Fetch new messages via Telegram Bot API getUpdates.

        Args:
            user_id: ManFriday user id.
            since: ISO-8601 timestamp string. Messages before this time are
                   skipped.  If *None*, all available updates are returned.

        Returns:
            List of ``ConnectorItem`` objects, one per message.
        """
        bot_token = get_byok_key("telegram", user_id)
        base_url = TELEGRAM_API_BASE.format(token=bot_token)

        since_dt: datetime | None = None
        if since:
            since_dt = datetime.fromisoformat(since)
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=timezone.utc)

        items: list[ConnectorItem] = []
        offset: int = 0
        max_iterations = 50  # safety cap

        async with httpx.AsyncClient(timeout=30) as client:
            for _ in range(max_iterations):
                params: dict[str, Any] = {
                    "offset": offset,
                    "limit": 100,
                    "timeout": 0,  # non-blocking
                }
                resp = await client.get(f"{base_url}/getUpdates", params=params)
                resp.raise_for_status()
                body = resp.json()

                if not body.get("ok"):
                    logger.error("getUpdates returned ok=false: %s", body)
                    break

                updates: list[dict] = body.get("result", [])
                if not updates:
                    break

                for update in updates:
                    offset = update["update_id"] + 1
                    item = self._update_to_item(update, since_dt)
                    if item is not None:
                        items.append(item)

                # If fewer than limit, we've exhausted available updates
                if len(updates) < 100:
                    break

        logger.info("Telegram poll for user %s returned %d items", user_id, len(items))
        return items

    # ------------------------------------------------------------------ #
    #  disconnect
    # ------------------------------------------------------------------ #
    async def disconnect(self, user_id: str) -> None:
        """Delete the stored bot token from Secret Manager."""
        delete_byok_key("telegram", user_id)
        logger.info("Telegram connector disconnected for user %s", user_id)

    # ------------------------------------------------------------------ #
    #  helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _update_to_item(
        update: dict[str, Any], since_dt: datetime | None
    ) -> ConnectorItem | None:
        """Convert a single Telegram Update object to a ConnectorItem.

        Returns None if the update has no usable message or predates *since_dt*.
        """
        # Telegram updates can contain message, edited_message, channel_post, etc.
        msg: dict[str, Any] | None = (
            update.get("message")
            or update.get("edited_message")
            or update.get("channel_post")
            or update.get("edited_channel_post")
        )
        if msg is None:
            return None

        # Timestamp filter
        msg_date = msg.get("date")
        if msg_date is not None and since_dt is not None:
            msg_dt = datetime.fromtimestamp(msg_date, tz=timezone.utc)
            if msg_dt < since_dt:
                return None

        chat: dict[str, Any] = msg.get("chat", {})
        chat_id = chat.get("id", "unknown")
        chat_name = (
            chat.get("title")
            or chat.get("username")
            or chat.get("first_name", "unknown")
        )
        message_id = msg.get("message_id", "unknown")

        sender: dict[str, Any] = msg.get("from", {})
        sender_name = " ".join(
            filter(None, [sender.get("first_name"), sender.get("last_name")])
        ) or sender.get("username", "unknown")

        text = msg.get("text") or msg.get("caption") or ""

        has_media = any(
            msg.get(k) is not None
            for k in ("photo", "video", "document", "audio", "voice", "sticker")
        )

        timestamp = (
            datetime.fromtimestamp(msg_date, tz=timezone.utc).isoformat()
            if msg_date
            else None
        )

        title = f"Telegram: {sender_name} in {chat_name}"
        if len(text) > 60:
            title = f"Telegram: {text[:57]}..."

        return ConnectorItem(
            source_url=f"telegram://{chat_id}/{message_id}",
            source_type="telegram",
            title=title,
            raw_content=text if text else None,
            metadata={
                "chat_id": chat_id,
                "chat_name": chat_name,
                "sender": sender_name,
                "timestamp": timestamp,
                "has_media": has_media,
            },
        )
