"""Google Drive connector — fetches documents via the Drive and Docs APIs.

Supports Google Docs (exported as plain text), Google Sheets (exported as
CSV), PDFs (downloaded as binary, base64-encoded in raw_content), and plain
text files.  Uses OAuth 2.0 with drive.readonly scope.
"""

from __future__ import annotations

import base64
import logging
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

DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"
DOCS_API_BASE = "https://docs.googleapis.com/v1/documents"
_MAX_RESULTS_PER_PAGE = 100
_MAX_PAGES = 10  # safety cap: 1 000 files per poll

# Mapping of Google Workspace MIME types to export targets
_EXPORT_MAP: dict[str, tuple[str, str]] = {
    # (export MIME type, file extension for title)
    "application/vnd.google-apps.document": ("text/plain", "txt"),
    "application/vnd.google-apps.spreadsheet": ("text/csv", "csv"),
}

# MIME types we download directly (binary or text)
_DOWNLOAD_MIMES: set[str] = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "application/json",
}


def _is_text_mime(mime: str) -> bool:
    """Return True if the MIME type should be treated as text."""
    return mime.startswith("text/") or mime in {"application/json"}


class GDriveConnector(ConnectorBase):
    """Connector that polls Google Drive for new/modified files."""

    CONNECTOR_TYPE = "gdrive"

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
            tokens["client_id"] = credentials["client_id"]
            tokens["client_secret"] = credentials["client_secret"]
            store_tokens("gdrive", user_id, tokens)
            logger.info("GDrive connector: tokens stored for user %s", user_id)
            return True
        except Exception:
            logger.exception("GDrive connector: connect failed for user %s", user_id)
            return False

    # ------------------------------------------------------------------
    # poll
    # ------------------------------------------------------------------
    async def poll(self, user_id: str, since: str | None = None) -> list[ConnectorItem]:
        """Fetch files modified after *since* (ISO-8601 or epoch string).

        Returns a :class:`ConnectorItem` per supported file.
        """
        tokens = load_tokens("gdrive", user_id)
        if not tokens:
            raise RuntimeError(f"No stored tokens for GDrive user {user_id}")

        access_token = await get_valid_access_token(
            "gdrive",
            user_id,
        )
        if not access_token:
            raise RuntimeError(f"Unable to obtain valid access token for GDrive user {user_id}")

        # Build query
        query_parts = ["trashed = false"]
        if since:
            try:
                dt = datetime.fromisoformat(since)
            except ValueError:
                dt = datetime.fromtimestamp(float(since), tz=timezone.utc)
            rfc3339 = dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            query_parts.append(f"modifiedTime > '{rfc3339}'")

        query = " and ".join(query_parts)
        headers = {"Authorization": f"Bearer {access_token}"}
        items: list[ConnectorItem] = []

        async with httpx.AsyncClient(timeout=60.0) as client:
            # --- list files (paginated) ---
            files: list[dict[str, Any]] = []
            page_token: str | None = None

            for _ in range(_MAX_PAGES):
                params: dict[str, Any] = {
                    "q": query,
                    "pageSize": _MAX_RESULTS_PER_PAGE,
                    "fields": "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, owners)",
                    "orderBy": "modifiedTime desc",
                }
                if page_token:
                    params["pageToken"] = page_token

                resp = await client.get(
                    f"{DRIVE_API_BASE}/files",
                    headers=headers,
                    params=params,
                )
                resp.raise_for_status()
                data = resp.json()
                files.extend(data.get("files", []))

                page_token = data.get("nextPageToken")
                if not page_token:
                    break

            logger.info(
                "GDrive connector: found %d files for user %s",
                len(files),
                user_id,
            )

            # --- fetch content for each file ---
            for file_info in files:
                file_id: str = file_info["id"]
                name: str = file_info.get("name", "Untitled")
                mime: str = file_info.get("mimeType", "")
                modified: str = file_info.get("modifiedTime", "")
                web_link: str = file_info.get("webViewLink", "")
                owners = file_info.get("owners", [])
                owner_email = owners[0].get("emailAddress", "") if owners else ""

                try:
                    content, source_type = await self._fetch_content(
                        client, headers, file_id, mime
                    )
                    if content is None:
                        # Unsupported file type — skip
                        logger.debug(
                            "GDrive connector: skipping unsupported MIME %s for file %s",
                            mime,
                            name,
                        )
                        continue

                    items.append(
                        ConnectorItem(
                            source_url=web_link or f"gdrive://{file_id}",
                            source_type=source_type,
                            title=name,
                            raw_content=content,
                            metadata={
                                "drive_file_id": file_id,
                                "mime_type": mime,
                                "modified_time": modified,
                                "owner": owner_email,
                            },
                        )
                    )
                except Exception:
                    logger.exception(
                        "GDrive connector: failed to fetch file %s (%s) for user %s",
                        name,
                        file_id,
                        user_id,
                    )

        return items

    # ------------------------------------------------------------------
    # _fetch_content  (private helper)
    # ------------------------------------------------------------------
    async def _fetch_content(
        self,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        file_id: str,
        mime: str,
    ) -> tuple[str | None, str]:
        """Download or export a single file.  Returns (content, source_type).

        For Google Docs, content is the plain-text export.
        For Google Sheets, content is CSV.
        For PDFs, content is the base64-encoded binary.
        For text files, content is the raw UTF-8 text.
        Unsupported types return (None, "").
        """
        # --- Google Workspace export types ---
        if mime in _EXPORT_MAP:
            export_mime, ext = _EXPORT_MAP[mime]

            if mime == "application/vnd.google-apps.document":
                # Use the Docs API for richer plain-text extraction
                resp = await client.get(
                    f"{DOCS_API_BASE}/{file_id}",
                    headers=headers,
                )
                resp.raise_for_status()
                doc = resp.json()
                text = self._extract_doc_text(doc)
                return text, "gdrive_doc"

            # Sheets — export as CSV via Drive export endpoint
            resp = await client.get(
                f"{DRIVE_API_BASE}/files/{file_id}/export",
                headers=headers,
                params={"mimeType": export_mime},
            )
            resp.raise_for_status()
            return resp.text, f"gdrive_{ext}"

        # --- Direct download types ---
        if mime in _DOWNLOAD_MIMES:
            resp = await client.get(
                f"{DRIVE_API_BASE}/files/{file_id}",
                headers=headers,
                params={"alt": "media"},
            )
            resp.raise_for_status()

            if mime == "application/pdf":
                encoded = base64.b64encode(resp.content).decode("ascii")
                return encoded, "gdrive_pdf"

            # Text-like files
            return resp.text, "gdrive_text"

        # Unsupported MIME type
        return None, ""

    # ------------------------------------------------------------------
    # _extract_doc_text  (private helper)
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_doc_text(doc: dict[str, Any]) -> str:
        """Walk the Docs API structural elements and extract plain text."""
        parts: list[str] = []
        body = doc.get("body", {})
        for element in body.get("content", []):
            paragraph = element.get("paragraph")
            if not paragraph:
                continue
            for pe in paragraph.get("elements", []):
                text_run = pe.get("textRun")
                if text_run:
                    parts.append(text_run.get("content", ""))
            table = element.get("table")
            if table:
                for row in table.get("tableRows", []):
                    row_parts: list[str] = []
                    for cell in row.get("tableCells", []):
                        cell_text: list[str] = []
                        for cell_content in cell.get("content", []):
                            cell_para = cell_content.get("paragraph")
                            if cell_para:
                                for cpe in cell_para.get("elements", []):
                                    tr = cpe.get("textRun")
                                    if tr:
                                        cell_text.append(tr.get("content", "").strip())
                        row_parts.append(" ".join(cell_text))
                    parts.append(" | ".join(row_parts))
                parts.append("")  # blank line after table
        return "".join(parts)

    # ------------------------------------------------------------------
    # disconnect
    # ------------------------------------------------------------------
    async def disconnect(self, user_id: str) -> None:
        """Revoke the OAuth token and delete stored credentials."""
        tokens = load_tokens("gdrive", user_id)
        if tokens:
            tok = tokens.get("access_token") or tokens.get("refresh_token")
            if tok:
                try:
                    await revoke_token(tok)
                except Exception:
                    logger.warning(
                        "GDrive connector: token revocation failed for user %s (continuing with deletion)",
                        user_id,
                    )
        delete_tokens("gdrive", user_id)
        logger.info("GDrive connector: disconnected user %s", user_id)
