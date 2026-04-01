"""ToolRegistry - maps tools to their capabilities and defaults."""

import json
import os
from typing import Optional


class ToolRegistry:
    """Loads tool definitions from the registry directory."""

    def __init__(self, registry_dir: str):
        self.registry_dir = registry_dir
        self._tools: dict = {}
        self._load()

    def _load(self):
        if not os.path.exists(self.registry_dir):
            return
        for f in os.listdir(self.registry_dir):
            if not f.endswith(".json"):
                continue
            path = os.path.join(self.registry_dir, f)
            try:
                with open(path) as fh:
                    data = json.load(fh)
                    tool_name = data.get("name", f.replace(".json", ""))
                    self._tools[tool_name] = data
            except (json.JSONDecodeError, KeyError):
                continue

    def get_tool(self, name: str) -> Optional[dict]:
        return self._tools.get(name)

    def list_tools(self) -> list:
        return list(self._tools.keys())
