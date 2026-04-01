"""WorkflowTracer - captures tool call traces for playbook extraction."""

import json
import os
import time
from dataclasses import dataclass, field, asdict
from typing import List, Optional


@dataclass
class TraceEvent:
    """A single event in a workflow trace."""
    timestamp: float = field(default_factory=time.time)
    tool: str = ""
    action: str = ""
    params: dict = field(default_factory=dict)
    result_summary: str = ""
    human_instruction: str = ""
    correction: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TraceEvent":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class Trace:
    """A complete workflow trace."""
    id: str = ""
    events: List[TraceEvent] = field(default_factory=list)
    started: float = field(default_factory=time.time)
    completed: float = 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "events": [e.to_dict() for e in self.events],
            "started": self.started,
            "completed": self.completed,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Trace":
        return cls(
            id=d["id"],
            events=[TraceEvent.from_dict(e) for e in d.get("events", [])],
            started=d.get("started", 0),
            completed=d.get("completed", 0),
        )


class WorkflowTracer:
    """Manages workflow traces on disk."""

    def __init__(self, traces_dir: str):
        self.traces_dir = traces_dir
        os.makedirs(traces_dir, exist_ok=True)
        self._traces: dict = {}

    def _path(self, trace_id: str) -> str:
        return os.path.join(self.traces_dir, f"{trace_id}.json")

    def start_trace(self, trace_id: str) -> Trace:
        trace = Trace(id=trace_id)
        self._traces[trace_id] = trace
        return trace

    def load_trace(self, trace_id: str) -> Optional[Trace]:
        if trace_id in self._traces:
            return self._traces[trace_id]
        path = self._path(trace_id)
        if not os.path.exists(path):
            return None
        with open(path) as fh:
            trace = Trace.from_dict(json.load(fh))
            self._traces[trace_id] = trace
            return trace

    def add_event(self, event: TraceEvent):
        # Add to the most recent trace
        for trace in reversed(list(self._traces.values())):
            trace.events.append(event)
            return

    def flush(self, trace_id: str):
        trace = self._traces.get(trace_id)
        if not trace:
            return
        with open(self._path(trace_id), "w") as fh:
            json.dump(trace.to_dict(), fh, indent=2)
