"""
AdapterRegistry — loads and manages poller adapters from config.yml.

Config format (see config.example.yml):

    adapters:
      - name: jira
        class: ftm_inbox.adapters.jira.JiraAdapter
        interval_seconds: 60
        credentials:
          api_token: "..."
          email: "..."
        config:
          base_url: "https://myorg.atlassian.net"
          project_key: "OPS"

The registry uses importlib to load adapter classes by dotted module path,
validates that each class is a subclass of BaseAdapter, and confirms that
credentials are present (non-empty) before registering the adapter.
"""

import importlib
import logging
from pathlib import Path
from typing import Any

import yaml

from .base import BaseAdapter

logger = logging.getLogger(__name__)

_DEFAULT_CONFIG_PATH = (
    Path(__file__).resolve().parent.parent.parent / "config.yml"
)


class AdapterRegistryError(Exception):
    """Raised when an adapter cannot be loaded or validated."""


class AdapterRegistry:
    """
    Loads adapter definitions from config.yml and instantiates each one.

    Usage:
        registry = AdapterRegistry.from_config()
        for adapter in registry.adapters:
            adapter.run_cycle(conn)
    """

    def __init__(self) -> None:
        self._adapters: list[BaseAdapter] = []

    @property
    def adapters(self) -> list[BaseAdapter]:
        return list(self._adapters)

    @classmethod
    def from_config(
        cls, config_path: Path | None = None
    ) -> "AdapterRegistry":
        """
        Build a registry from a YAML config file.

        Args:
            config_path: Path to config.yml. Defaults to <project_root>/config.yml.

        Returns:
            Populated AdapterRegistry.

        Raises:
            AdapterRegistryError: If the config file is missing or an adapter
                                  fails validation.
        """
        path = config_path or _DEFAULT_CONFIG_PATH

        if not path.exists():
            logger.warning(
                "config.yml not found at %s — no adapters registered.", path
            )
            return cls()

        with path.open() as fh:
            raw = yaml.safe_load(fh) or {}

        adapter_defs: list[dict[str, Any]] = raw.get("adapters", [])
        registry = cls()

        for definition in adapter_defs:
            try:
                adapter = _load_adapter(definition)
                registry._adapters.append(adapter)
                logger.info(
                    "Registered adapter '%s' (%s)",
                    definition.get("name"),
                    definition.get("class"),
                )
            except AdapterRegistryError as exc:
                logger.error("Skipping adapter '%s': %s", definition.get("name"), exc)

        return registry

    def get(self, name: str) -> BaseAdapter | None:
        """Return a registered adapter by name, or None."""
        for adapter in self._adapters:
            if adapter.source_name == name:
                return adapter
        return None

    def __len__(self) -> int:
        return len(self._adapters)

    def __repr__(self) -> str:
        names = [a.source_name for a in self._adapters]
        return f"AdapterRegistry(adapters={names})"


def _load_adapter(definition: dict[str, Any]) -> BaseAdapter:
    """
    Instantiate a single adapter from its config definition.

    Validates:
      - 'class' key is present and is a valid dotted path
      - The resolved class is a subclass of BaseAdapter
      - Required credentials keys are present and non-empty

    Raises:
        AdapterRegistryError on any validation failure.
    """
    dotted_path: str = definition.get("class", "")
    if not dotted_path:
        raise AdapterRegistryError("Missing 'class' key in adapter definition.")

    module_path, _, class_name = dotted_path.rpartition(".")
    if not module_path:
        raise AdapterRegistryError(
            f"'class' must be a dotted path (got '{dotted_path}')."
        )

    try:
        module = importlib.import_module(module_path)
    except ImportError as exc:
        raise AdapterRegistryError(
            f"Cannot import module '{module_path}': {exc}"
        ) from exc

    klass = getattr(module, class_name, None)
    if klass is None:
        raise AdapterRegistryError(
            f"Class '{class_name}' not found in module '{module_path}'."
        )

    if not (isinstance(klass, type) and issubclass(klass, BaseAdapter)):
        raise AdapterRegistryError(
            f"'{dotted_path}' is not a subclass of BaseAdapter."
        )

    credentials: dict[str, Any] = definition.get("credentials", {}) or {}
    config: dict[str, Any] = definition.get("config", {}) or {}

    _validate_credentials(definition.get("name", dotted_path), credentials, klass)

    instance = klass(credentials=credentials, config=config)
    # Allow the class to declare its source_name via class attribute;
    # fall back to the 'name' key in the config definition.
    if not instance.source_name:
        instance.source_name = definition.get("name", class_name.lower())

    return instance


def _validate_credentials(
    adapter_name: str,
    credentials: dict[str, Any],
    klass: type,
) -> None:
    """
    Check that all keys declared in klass.required_credentials are present
    and non-empty in the credentials dict.

    Adapters opt into this by setting a class-level list:
        required_credentials = ["api_token", "email"]

    If the class doesn't declare required_credentials, skip validation.
    """
    required: list[str] = getattr(klass, "required_credentials", [])
    missing = [key for key in required if not credentials.get(key)]
    if missing:
        raise AdapterRegistryError(
            f"Adapter '{adapter_name}' missing required credentials: {missing}"
        )
