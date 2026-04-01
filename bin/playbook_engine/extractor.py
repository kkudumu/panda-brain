"""PlaybookExtractor - extracts playbooks from completed traces."""

from .models import Playbook, PlaybookStep
from .registry import ToolRegistry
from .tracer import Trace


class PlaybookExtractor:
    """Extracts a draft playbook from a workflow trace."""

    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    def extract_from_trace(self, trace: Trace, name: str = "Untitled") -> Playbook:
        steps = []
        for i, event in enumerate(trace.events, 1):
            step = PlaybookStep(
                number=i,
                description=event.human_instruction or event.action or f"Step {i}",
                tool=event.tool,
                tool_params=event.params,
                requires_human=bool(event.correction),
                notes=event.correction or "",
            )
            steps.append(step)

        return Playbook(
            name=name,
            description=f"Extracted from trace {trace.id}",
            steps=steps,
            source="extracted",
            confidence=0.7,  # draft confidence
        )
