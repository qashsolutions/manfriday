"""Gmail connector — fetches email messages via the Gmail API.

Uses OAuth 2.0 for authentication and the Gmail REST API v1 to list and
retrieve messages.  Heavy HTML bodies are converted to markdown via a
lightweight strip; text/plain parts are preferred when available.
"""

from __future__ import annotations

import base64
import email.utils
import html
import logging
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from workers.ingest.connectors.base import ConnectorBase, ConnectorItem
from workers.ingest.connectors.oauth import (
    delete_tokens,
    exchange_code,
    get_valid_access_token,
    load_tokens,
    revoke_token,
    store_tokens,
)

logger = logging.getLogger(__name__)

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
_MAX_RESULTS_PER_PAGE = 100
_MAX_PAGES = 10  # safety cap: 1 000 messages per poll


def _html_to_markdown(html_str: str) -> str:
    """Best-effort HTML-to-markdown conversion without external deps."""
    text = re.sub(r"<br\s*/?>", "\n", html_str, flags=re.IGNORECASE)
    text = re.sub(r"</?p[^>]*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?div[^>]*>", "\n", text, flags=re.IGNORECASE)
    # Bold
    text = re.sub(r"<b[^>]*>(.*?)</b>", r"**\1**", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<strong[^>]*>(.*?)</strong>", r"**\1**", text, flags=re.IGNORECASE | re.DOTALL)
    # Italic
    text = re.sub(r"<i[^>]*>(.*?)</i>", r"*\1*", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<em[^>]*>(.*?)</em>", r"*\1*", text, flags=re.IGNORECASE | re.DOTALL)
    # Links
    text = re.sub(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        r"[\2](\1)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    # Strip remaining tags
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    # Collapse excessive whitespace
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _decode_body(data: str) -> str:
    """Decode a Gmail base64url-encoded body part."""
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")


def _extract_body(payload: dict[str, Any]) -> str:
    """Walk a Gmail message payload and return the best available text body."""
    # Single-part message
    if payload.get("body", {}).get("data"):
        mime = payload.get("mimeType", "")
        text = _decode_body(payload["body"]["data"])
        if "html" in mime:
            return _html_to_markdown(text)
        return text

    # Multipart — prefer text/plain, fallback to text/html
    parts = payload.get("parts", [])
    plain_text: str | None = None
    html_text: str | None = None

    stack = list(parts)
    while stack:
        part = stack.pop()
        mime = part.get("mimeType", "")
        if mime == "text/plain" and part.get("body", {}).get("data"):
            plain_text = _decode_body(part["body"]["data"])
        elif mime == "text/html" and part.get("body", {}).get("data"):
            html_text = _decode_body(part["body"]["data"])
        # Nested multipart
        if part.get("parts"):
            stack.extend(part["parts"])

    if plain_text:
        return plain_text
    if html_text:
        return _html_to_markdown(html_text)
    return ""


def _get_header(headers: list[dict[str, str]], name: str) -> str:
    """Return the value of the first header matching *name* (case-insensitive)."""
    name_lower = name.lower()
    for h in headers:
        if h.get("name", "").lower() == name_lower:
            return h.get("value", "")
    return ""


class GmailConnector(ConnectorBase):
    """Connector that polls a user's Gmail inbox via the Gmail REST API."""

    CONNECTOR_TYPE = "gmail"

    # ------------------------------------------------------------------
    # connect
    # ------------------------------------------------------------------
    async def connect(self, user_id: str, credentials: dict[str, Any]) -> bool:
        """Exchange an OAuth authorization code and persist tokens.

        *credentials* must contain:
            code, client_id, client_secret, redirect_uri
        """
        try:
            tokens = await exchange_code(
                code=credentials["code"],
                client_id=credentials["client_id"],
                client_secret=credentials["client_secret"],
                redirect_uri=credentials["redirect_uri"],
            )
            # Persist client credentials alongside tokens so we can refresh later
            tokens["client_id"] = credentials["client_id"]
            tokens["client_secret"] = credentials["client_secret"]
            store_tokens("gmail", user_id, tokens)
            logger.info("Gmail connector: tokens stored for user %s", user_id)
            return True
        except Exception:
            logger.exception("Gmail connector: connect failed for user %s", user_id)
            return False

    # ------------------------------------------------------------------
    # poll
    # ------------------------------------------------------------------
    async def poll(self, user_id: str, since: str | None = None) -> list[ConnectorItem]:
        """Fetch messages received after *since* (ISO-8601 or epoch string).

        Returns a :class:`ConnectorItem` per message.
        """
        tokens = load_tokens("gmail", user_id)
        if not tokens:
            raise RuntimeError(f"No stored tokens for Gmail user {user_id}")

        access_token = await get_valid_access_token(
            "gmail",
            user_id,
        )
        if not access_token:
            raise RuntimeError(f"Unable to obtain valid access token for Gmail user {user_id}")

        # Build query: exclude spam/trash, filter by date if provided
        query_parts = ["-in:spam", "-in:trash"]
        if since:
            try:
                dt = datetime.fromisoformat(since)
            except ValueError:
                dt = datetime.fromtimestamp(float(since), tz=timezone.utc)
            # Gmail search uses epoch seconds for after: filter
            epoch = int(dt.timestamp())
            query_parts.append(f"after:{epoch}")
        query = " ".join(query_parts)

        headers = {"Authorization": f"Bearer {access_token}"}
        items: list[ConnectorItem] = []

        async with httpx.AsyncClient(timeout=30.0) as client:
            # --- list message IDs (paginated) ---
            message_ids: list[str] = []
            page_token: str | None = None

            for _ in range(_MAX_PAGES):
                params: dict[str, Any] = {
                    "q": query,
                    "maxResults": _MAX_RESULTS_PER_PAGE,
                }
                if page_token:
                    params["pageToken"] = page_token

                resp = await client.get(
                    f"{GMAIL_API_BASE}/messages",
                    headers=headers,
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()

                for msg in data.get("messages", []):
                    message_ids.append(msg["id"])

                page_token = data.get("nextPageToken")
                if not page_token:
                    break

            logger.info(
                "Gmail connector: found %d messages for user %s",
                len(message_ids),
                user_id,
            )

            # --- fetch each message ---
            for msg_id in message_ids:
                try:
                    resp = await client.get(
                        f"{GMAIL_API_BASE}/messages/{msg_id}",
                        headers=headers,
                        params={"format": "full"},
                    )
                    resp.raise_for_status()
                    msg_data = resp.json()

                    payload = msg_data.get("payload", {})
                    msg_headers = payload.get("headers", [])

                    sender = _get_header(msg_headers, "From")
                    subject = _get_header(msg_headers, "Subject")
                    date_str = _get_header(msg_headers, "Date")
                    has_unsub = _get_header(msg_headers, "List-Unsubscribe") != ""

                    body = _extract_body(payload)

                    # Labels
                    label_ids: list[str] = msg_data.get("labelIds", [])
                    starred = "STARRED" in label_ids
                    # Filter out system labels to get user labels
                    system_labels = {
                        "INBOX", "SENT", "DRAFT", "SPAM", "TRASH", "UNREAD",
                        "STARRED", "IMPORTANT", "CATEGORY_PERSONAL",
                        "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS",
                        "CATEGORY_UPDATES", "CATEGORY_FORUMS",
                    }
                    user_labels = [l for l in label_ids if l not in system_labels]

                    # Parse date for title
                    parsed_date = ""
                    if date_str:
                        try:
                            parsed = email.utils.parsedate_to_datetime(date_str)
                            parsed_date = parsed.strftime("%Y-%m-%d")
                        except Exception:
                            parsed_date = date_str

                    title = f"{subject} — from {sender}"
                    if parsed_date:
                        title = f"[{parsed_date}] {title}"

                    items.append(
                        ConnectorItem(
                            source_url=f"gmail://{msg_id}",
                            source_type="gmail",
                            title=title,
                            raw_content=body,
                            metadata={
                                "from": sender,
                                "subject": subject,
                                "date": date_str,
                                "starred": starred,
                                "has_list_unsubscribe": has_unsub,
                                "user_labels": user_labels,
                            },
                        )
                    )
                except Exception:
                    logger.exception(
                        "Gmail connector: failed to fetch message %s for user %s",
                        msg_id,
                        user_id,
                    )

        return items

    # ------------------------------------------------------------------
    # disconnect
    # ------------------------------------------------------------------
    async def disconnect(self, user_id: str) -> None:
        """Revoke the OAuth token and delete stored credentials."""
        tokens = load_tokens("gmail", user_id)
        if tokens:
            tok = tokens.get("access_token") or tokens.get("refresh_token")
            if tok:
                try:
                    await revoke_token(tok)
                except Exception:
                    logger.warning(
                        "Gmail connector: token revocation failed for user %s (continuing with deletion)",
                        user_id,
                    )
        delete_tokens("gmail", user_id)
        logger.info("Gmail connector: disconnected user %s", user_id)
