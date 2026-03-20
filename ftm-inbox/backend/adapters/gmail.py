"""
GmailAdapter — polls Gmail for recent emails matching a label filter.

Required credentials:
    credentials_json_path   Path to Google OAuth credentials JSON
    token_path              Path to stored OAuth token

Config keys:
    label_filter    Gmail label to filter by, default "INBOX"
    max_results     Max emails per poll cycle, default 50
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import requests

from backend.adapters._retry import retry
from backend.adapters.base import BaseAdapter, NormalizedItem

logger = logging.getLogger(__name__)


class GmailAdapter(BaseAdapter):
    """Polls Gmail for recent emails using the Gmail REST API."""

    source_name = "gmail"
    required_credentials = ["credentials_json_path"]

    def __init__(self, credentials: dict, config: dict) -> None:
        super().__init__(credentials, config)
        self._credentials_path = Path(
            credentials.get("credentials_json_path", "")
        ).expanduser()
        self._token_path = Path(
            credentials.get("token_path", "~/.config/ftm-inbox/gmail-token.json")
        ).expanduser()
        self._label_filter = config.get("label_filter", "INBOX")
        self._max_results = int(config.get("max_results", 50))
        self._access_token: str | None = None

    def _get_access_token(self) -> str:
        """Load OAuth access token from token file."""
        if self._access_token:
            return self._access_token

        if not self._token_path.exists():
            raise RuntimeError(
                f"Gmail token file not found at {self._token_path}. "
                "Run the setup wizard first."
            )

        token_data = json.loads(self._token_path.read_text())
        self._access_token = token_data.get("access_token", "")
        if not self._access_token:
            raise RuntimeError("Gmail token file has no access_token field.")
        return self._access_token

    @retry(max_attempts=3, base_delay=1.0, exceptions=(requests.RequestException,))
    def poll(self) -> list[dict]:
        """Fetch recent emails from Gmail matching the label filter."""
        token = self._get_access_token()
        headers = {"Authorization": f"Bearer {token}"}

        url = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
        params: dict[str, Any] = {
            "maxResults": self._max_results,
            "labelIds": self._label_filter,
        }
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        message_ids = [m["id"] for m in data.get("messages", [])]

        messages: list[dict] = []
        for msg_id in message_ids:
            msg_url = f"{url}/{msg_id}"
            msg_params = {"format": "metadata", "metadataHeaders": "Subject,From,Date"}
            msg_response = requests.get(
                msg_url, headers=headers, params=msg_params, timeout=30
            )
            if msg_response.ok:
                messages.append(msg_response.json())

        return messages

    def normalize(self, raw_item: dict) -> NormalizedItem:
        """Map a Gmail message dict to NormalizedItem."""
        msg_id = raw_item.get("id", "")
        headers = raw_item.get("payload", {}).get("headers", [])

        header_map: dict[str, str] = {}
        for h in headers:
            header_map[h.get("name", "").lower()] = h.get("value", "")

        title = header_map.get("subject") or "(no subject)"
        requester = header_map.get("from")
        created_at = header_map.get("date")

        snippet = raw_item.get("snippet", "")

        source_url = f"https://mail.google.com/mail/u/0/#inbox/{msg_id}"

        label_ids: list[str] = raw_item.get("labelIds", [])

        return NormalizedItem(
            source=self.source_name,
            source_id=msg_id,
            title=title,
            body=snippet,
            status="open",
            priority="medium",
            assignee=None,
            requester=requester,
            created_at=created_at,
            updated_at=None,
            tags=label_ids,
            custom_fields={},
            raw_payload=raw_item,
            source_url=source_url,
        )
