"""
UnifiedTask — canonical Pydantic model for a task regardless of source.

This is the read/API-facing model. The write path uses NormalizedItem (a dataclass)
for speed; UnifiedTask is the model returned to callers and stored as JSON.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class UnifiedTask(BaseModel):
    """Single unified representation of a task from any integrated source."""

    id: int | None = None
    source: str
    source_id: str
    title: str
    body: str = ""
    status: str = "open"
    priority: str = "medium"
    assignee: str | None = None
    requester: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    tags: list[str] = Field(default_factory=list)
    custom_fields: dict[str, Any] = Field(default_factory=dict)
    raw_payload: dict[str, Any] = Field(default_factory=dict)
    source_url: str | None = None
    content_hash: str | None = None
    ingested_at: str | None = None

    model_config = {"populate_by_name": True}
