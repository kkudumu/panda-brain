"""
JiraAdapter — polls a Jira project via the REST API v3 and normalizes issues.

Required credentials:
    api_token   Jira API token (generated at id.atlassian.net)
    email       Atlassian account email associated with the token

Config keys:
    base_url    e.g. "https://myorg.atlassian.net"
    jql         JQL filter string, default "assignee = currentUser() ORDER BY updated DESC"
    max_results Number of issues to fetch per poll cycle, default 50
"""

from __future__ import annotations

import logging
from typing import Any

import requests
from requests.auth import HTTPBasicAuth

from backend.adapters._retry import retry
from backend.adapters.base import BaseAdapter, NormalizedItem

logger = logging.getLogger(__name__)

_DEFAULT_JQL = "assignee = currentUser() ORDER BY updated DESC"
_DEFAULT_MAX_RESULTS = 50


class JiraAdapter(BaseAdapter):
    """Polls Jira issues using the REST API v3."""

    source_name = "jira"
    required_credentials = ["api_token", "email"]

    def __init__(self, credentials: dict, config: dict) -> None:
        super().__init__(credentials, config)
        self._base_url = config.get("base_url", "").rstrip("/")
        if not self._base_url:
            raise ValueError("JiraAdapter requires config['base_url']")
        self._auth = HTTPBasicAuth(
            credentials["email"], credentials["api_token"]
        )
        self._jql = config.get("jql", _DEFAULT_JQL)
        self._max_results = int(config.get("max_results", _DEFAULT_MAX_RESULTS))

    @retry(max_attempts=3, base_delay=1.0, exceptions=(requests.RequestException,))
    def poll(self) -> list[dict]:
        """Fetch Jira issues matching the configured JQL query."""
        url = f"{self._base_url}/rest/api/3/search"
        params: dict[str, Any] = {
            "jql": self._jql,
            "maxResults": self._max_results,
            "fields": (
                "summary,description,status,priority,"
                "assignee,reporter,created,updated,labels,issuetype"
            ),
        }
        response = requests.get(url, auth=self._auth, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()
        return data.get("issues", [])

    def normalize(self, raw_item: dict) -> NormalizedItem:
        """Map a Jira issue dict to NormalizedItem."""
        fields = raw_item.get("fields") or {}
        key = raw_item.get("key", "")
        issue_id = raw_item.get("id", key)

        title = fields.get("summary") or key or "(no summary)"
        body = _extract_jira_text(fields.get("description"))

        status_obj = fields.get("status") or {}
        status = (status_obj.get("name") or "open").lower()

        priority_obj = fields.get("priority") or {}
        priority = (priority_obj.get("name") or "medium").lower()

        assignee_obj = fields.get("assignee") or {}
        assignee = assignee_obj.get("displayName") or assignee_obj.get("emailAddress")

        reporter_obj = fields.get("reporter") or {}
        requester = reporter_obj.get("displayName") or reporter_obj.get("emailAddress")

        created_at = fields.get("created")
        updated_at = fields.get("updated")

        tags: list[str] = fields.get("labels") or []

        issuetype_obj = fields.get("issuetype") or {}
        custom_fields: dict[str, Any] = {}
        if issuetype_obj.get("name"):
            custom_fields["issue_type"] = issuetype_obj["name"]

        source_url = f"{self._base_url}/browse/{key}" if key else None

        return NormalizedItem(
            source=self.source_name,
            source_id=str(issue_id),
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


def _extract_jira_text(adf: Any) -> str:
    """Recursively pull plain text from an Atlassian Document Format node."""
    if adf is None:
        return ""
    if isinstance(adf, str):
        return adf
    if not isinstance(adf, dict):
        return ""

    node_type = adf.get("type", "")
    if node_type == "text":
        return adf.get("text", "")

    parts: list[str] = []
    for child in adf.get("content") or []:
        part = _extract_jira_text(child)
        if part:
            parts.append(part)

    separator = "\n" if node_type in ("paragraph", "heading", "bulletList", "orderedList") else " "
    return separator.join(parts).strip()
