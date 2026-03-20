"""
SlackAdapter — polls Slack channels for recent messages.

Required credentials:
    bot_token   Slack bot token (xoxb-...)

Config keys:
    channels        List of channel IDs to poll
    lookback_hours  How far back to fetch messages, default 24
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

from backend.adapters._retry import retry
from backend.adapters.base import BaseAdapter, NormalizedItem

logger = logging.getLogger(__name__)


class SlackAdapter(BaseAdapter):
    """Polls Slack channels for recent messages."""

    source_name = "slack"
    required_credentials = ["bot_token"]

    def __init__(self, credentials: dict, config: dict) -> None:
        super().__init__(credentials, config)
        self._token = credentials["bot_token"]
        self._channels: list[str] = config.get("channels", [])
        self._lookback_hours = int(config.get("lookback_hours", 24))
        self._headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    @retry(max_attempts=3, base_delay=1.0, exceptions=(requests.RequestException,))
    def poll(self) -> list[dict]:
        """Fetch recent messages from configured Slack channels."""
        oldest = str(time.time() - self._lookback_hours * 3600)
        all_messages: list[dict] = []

        for channel_id in self._channels:
            url = "https://slack.com/api/conversations.history"
            params: dict[str, Any] = {
                "channel": channel_id,
                "oldest": oldest,
                "limit": 200,
            }
            response = requests.get(
                url, headers=self._headers, params=params, timeout=30
            )
            response.raise_for_status()
            data = response.json()

            if not data.get("ok"):
                logger.warning(
                    "Slack API error for channel %s: %s",
                    channel_id,
                    data.get("error", "unknown"),
                )
                continue

            messages = data.get("messages", [])
            for msg in messages:
                msg["_channel_id"] = channel_id
            all_messages.extend(messages)

        return all_messages

    def normalize(self, raw_item: dict) -> NormalizedItem:
        """Map a Slack message dict to NormalizedItem."""
        ts = raw_item.get("ts", "")
        channel_id = raw_item.get("_channel_id", "")
        text = raw_item.get("text") or ""

        title = text[:100].replace("\n", " ") if text else "(no text)"
        body = text

        user = raw_item.get("user") or raw_item.get("bot_id") or "unknown"

        created_at = ts

        source_url = (
            f"https://slack.com/archives/{channel_id}/p{ts.replace('.', '')}"
            if channel_id and ts
            else None
        )

        return NormalizedItem(
            source=self.source_name,
            source_id=f"{channel_id}:{ts}",
            title=title,
            body=body,
            status="open",
            priority="medium",
            assignee=None,
            requester=user,
            created_at=created_at,
            updated_at=None,
            tags=[],
            custom_fields={"channel_id": channel_id},
            raw_payload=raw_item,
            source_url=source_url,
        )
