"""
FreshserviceAdapter — polls Freshservice tickets via the REST API v2.

Required credentials:
    api_key     Freshservice API key (Settings > API in Freshservice admin)

Config keys:
    domain      e.g. "yourorg.freshservice.com"
    per_page    Number of tickets per page, default 100
"""

from __future__ import annotations

import logging
from typing import Any

import requests
from requests.auth import HTTPBasicAuth

from backend.adapters._retry import retry
from backend.adapters.base import BaseAdapter, NormalizedItem

logger = logging.getLogger(__name__)

_STATUS_MAP = {2: "open", 3: "pending", 4: "resolved", 5: "closed"}
_PRIORITY_MAP = {1: "low", 2: "medium", 3: "high", 4: "urgent"}


class FreshserviceAdapter(BaseAdapter):
    """Polls Freshservice tickets via REST API v2."""

    source_name = "freshservice"
    required_credentials = ["api_key"]

    def __init__(self, credentials: dict, config: dict) -> None:
        super().__init__(credentials, config)
        self._domain = config.get("domain", "")
        if not self._domain:
            raise ValueError("FreshserviceAdapter requires config['domain']")
        self._auth = HTTPBasicAuth(credentials["api_key"], "X")
        self._per_page = int(config.get("per_page", 100))

    @retry(max_attempts=3, base_delay=1.0, exceptions=(requests.RequestException,))
    def poll(self) -> list[dict]:
        """Fetch tickets from Freshservice with pagination."""
        url = f"https://{self._domain}/api/v2/tickets"
        params: dict[str, Any] = {
            "per_page": self._per_page,
            "order_by": "updated_at",
            "order_type": "desc",
        }
        response = requests.get(url, auth=self._auth, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        return data.get("tickets", [])

    def normalize(self, raw_item: dict) -> NormalizedItem:
        """Map a Freshservice ticket dict to NormalizedItem."""
        ticket_id = str(raw_item.get("id", ""))

        title = raw_item.get("subject") or "(no subject)"
        body = raw_item.get("description_text") or raw_item.get("description") or ""

        status_int = raw_item.get("status", 2)
        status = _STATUS_MAP.get(status_int, "open")

        priority_int = raw_item.get("priority", 2)
        priority = _PRIORITY_MAP.get(priority_int, "medium")

        requester_id = raw_item.get("requester_id")
        requester = str(requester_id) if requester_id else None

        responder_id = raw_item.get("responder_id")
        assignee = str(responder_id) if responder_id else None

        created_at = raw_item.get("created_at")
        updated_at = raw_item.get("updated_at")

        tags: list[str] = raw_item.get("tags") or []

        custom_fields: dict[str, Any] = {}
        raw_cf = raw_item.get("custom_fields") or {}
        for key, value in raw_cf.items():
            if value is not None:
                custom_fields[key] = value

        source_url = f"https://{self._domain}/a/tickets/{ticket_id}"

        return NormalizedItem(
            source=self.source_name,
            source_id=ticket_id,
            title=title,
            body=body,
            status=status,
            priority=priority,
            assignee=assignee,
            requester=requester,
            created_at=created_at,
            updated_at=updated_at,
            tags=tags,
            custom_fields=custom_fields,
            raw_payload=raw_item,
            source_url=source_url,
        )
