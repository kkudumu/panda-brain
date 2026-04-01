"""Core data models for playbooks."""

import uuid
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class PlaybookStep:
    """A single step in a playbook."""
    number: int
    description: str
    tool: str = ""  # e.g. "browser", "freshservice-api", "manual"
    tool_params: dict = field(default_factory=dict)
    requires_human: bool = False
    notes: str = ""

    def to_dict(self) -> dict:
        return {
            "number": self.number,
            "description": self.description,
            "tool": self.tool,
            "tool_params": self.tool_params,
            "requires_human": self.requires_human,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "PlaybookStep":
        return cls(
            number=d["number"],
            description=d["description"],
            tool=d.get("tool", ""),
            tool_params=d.get("tool_params", {}),
            requires_human=d.get("requires_human", False),
            notes=d.get("notes", ""),
        )


@dataclass
class Playbook:
    """A reusable workflow playbook."""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str = ""
    description: str = ""
    trigger_keywords: List[str] = field(default_factory=list)
    steps: List[PlaybookStep] = field(default_factory=list)
    confidence: float = 1.0
    version: int = 1
    executions: int = 0
    source: str = "manual"  # "manual", "extracted", "observed"
    runbook_path: str = ""  # link to full runbook doc
    related_links: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "trigger_keywords": self.trigger_keywords,
            "steps": [s.to_dict() for s in self.steps],
            "confidence": self.confidence,
            "version": self.version,
            "executions": self.executions,
            "source": self.source,
            "runbook_path": self.runbook_path,
            "related_links": self.related_links,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Playbook":
        return cls(
            id=d["id"],
            name=d.get("name", ""),
            description=d.get("description", ""),
            trigger_keywords=d.get("trigger_keywords", []),
            steps=[PlaybookStep.from_dict(s) for s in d.get("steps", [])],
            confidence=d.get("confidence", 1.0),
            version=d.get("version", 1),
            executions=d.get("executions", 0),
            source=d.get("source", "manual"),
            runbook_path=d.get("runbook_path", ""),
            related_links=d.get("related_links", {}),
        )
