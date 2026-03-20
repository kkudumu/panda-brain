"""
BaseAdapter — abstract interface all poller adapters must implement.

Every adapter handles one external system (Jira, Freshservice, Slack, etc.)
and is responsible for fetching, normalizing, deduplicating, and storing
items into the ftm-inbox database.

Deduplication uses a SHA-256 hash of (source + source_id) so the same
external item is never stored twice regardless of content changes.
To track updates, adapters should update the existing row rather than
insert a duplicate.
"""

import hashlib
import json
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any


class NormalizedItem:
    """Canonical representation of an inbox item before storage."""

    __slots__ = (
        "source",
        "source_id",
        "title",
        "body",
        "status",
        "priority",
        "assignee",
        "requester",
        "created_at",
        "updated_at",
        "tags",
        "custom_fields",
        "raw_payload",
        "source_url",
        "content_hash",
    )

    def __init__(
        self,
        source: str,
        source_id: str,
        title: str,
        body: str = "",
        status: str = "open",
        priority: str = "medium",
        assignee: str | None = None,
        requester: str | None = None,
        created_at: str | None = None,
        updated_at: str | None = None,
        tags: list[str] | None = None,
        custom_fields: dict[str, Any] | None = None,
        raw_payload: dict[str, Any] | None = None,
        source_url: str | None = None,
    ) -> None:
        self.source = source
        self.source_id = source_id
        self.title = title
        self.body = body
        self.status = status
        self.priority = priority
        self.assignee = assignee
        self.requester = requester
        self.created_at = created_at
        self.updated_at = updated_at
        self.tags = tags or []
        self.custom_fields = custom_fields or {}
        self.raw_payload = raw_payload or {}
        self.source_url = source_url
        self.content_hash = _compute_hash(source, source_id)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "source_id": self.source_id,
            "title": self.title,
            "body": self.body,
            "status": self.status,
            "priority": self.priority,
            "assignee": self.assignee,
            "requester": self.requester,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "tags": json.dumps(self.tags),
            "custom_fields": json.dumps(self.custom_fields),
            "raw_payload": json.dumps(self.raw_payload),
            "source_url": self.source_url,
            "content_hash": self.content_hash,
        }


def _compute_hash(source: str, source_id: str) -> str:
    """SHA-256 of 'source:source_id' — stable dedup key."""
    raw = f"{source}:{source_id}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


class BaseAdapter(ABC):
    """
    Abstract base class for all ftm-inbox poller adapters.

    Subclasses must implement poll(), normalize(), and optionally override
    deduplicate() and store() if the defaults don't suit the source.

    Lifecycle per poll cycle:
        raw_items  = self.poll()
        normalized = [self.normalize(item) for item in raw_items]
        new_items  = self.deduplicate(normalized, conn)
        self.store(new_items, conn)
    """

    #: Unique identifier for this adapter, e.g. "jira", "freshservice"
    source_name: str = ""

    def __init__(self, credentials: dict[str, Any], config: dict[str, Any]) -> None:
        """
        Args:
            credentials: Secrets from config.yml (API keys, tokens, etc.)
            config:      Non-secret settings (base_url, project_key, etc.)
        """
        self.credentials = credentials
        self.config = config

    @abstractmethod
    def poll(self) -> list[dict[str, Any]]:
        """
        Fetch raw items from the external system.

        Returns:
            List of raw dicts as returned by the source API.
        """
        ...

    @abstractmethod
    def normalize(self, raw_item: dict[str, Any]) -> NormalizedItem:
        """
        Convert a raw API item into a NormalizedItem.

        Args:
            raw_item: One element from the list returned by poll().

        Returns:
            NormalizedItem ready for deduplication and storage.
        """
        ...

    def deduplicate(
        self, items: list[NormalizedItem], conn
    ) -> list[NormalizedItem]:
        """
        Filter out items already present in the database by content_hash.

        Uses the UNIQUE constraint on inbox.content_hash. Returns only
        items that do not yet exist.

        Args:
            items: Normalized items from this poll cycle.
            conn:  Active sqlite3 connection.

        Returns:
            Subset of items not yet in the database.
        """
        if not items:
            return []

        hashes = [item.content_hash for item in items]
        placeholders = ",".join("?" * len(hashes))
        rows = conn.execute(
            f"SELECT content_hash FROM inbox WHERE content_hash IN ({placeholders})",
            hashes,
        ).fetchall()
        existing = {row["content_hash"] for row in rows}
        return [item for item in items if item.content_hash not in existing]

    def store(self, items: list[NormalizedItem], conn) -> int:
        """
        Insert new items into the inbox table.

        Skips items that already exist (content_hash collision) rather than
        raising — adapters that want upsert behavior should override this.

        Args:
            items: Deduplicated NormalizedItems to insert.
            conn:  Active sqlite3 connection.

        Returns:
            Number of rows actually inserted.
        """
        if not items:
            return 0

        inserted = 0
        for item in items:
            data = item.to_dict()
            try:
                conn.execute(
                    """
                    INSERT INTO inbox
                        (source, source_id, title, body, status, priority,
                         assignee, requester, created_at, updated_at,
                         tags, custom_fields, raw_payload, source_url, content_hash)
                    VALUES
                        (:source, :source_id, :title, :body, :status, :priority,
                         :assignee, :requester, :created_at, :updated_at,
                         :tags, :custom_fields, :raw_payload, :source_url, :content_hash)
                    """,
                    data,
                )
                inserted += 1
            except Exception:
                # Swallow duplicate key errors; log others in production
                pass

        conn.commit()
        return inserted

    def run_cycle(self, conn) -> int:
        """
        Execute a full poll-normalize-deduplicate-store cycle.

        Returns:
            Number of new items stored.
        """
        raw_items = self.poll()
        normalized = [self.normalize(item) for item in raw_items]
        new_items = self.deduplicate(normalized, conn)
        return self.store(new_items, conn)
