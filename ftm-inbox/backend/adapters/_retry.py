"""
Exponential-backoff retry decorator for HTTP adapter calls.

Usage:
    @retry(max_attempts=3, base_delay=1.0)
    def poll(self) -> list[dict]:
        ...
"""

from __future__ import annotations

import functools
import logging
import time
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable)


def retry(
    max_attempts: int = 3,
    base_delay: float = 1.0,
    backoff_factor: float = 2.0,
    exceptions: tuple[type[Exception], ...] = (Exception,),
) -> Callable[[F], F]:
    """
    Decorator: retry on exception with exponential backoff.

    Args:
        max_attempts: Total number of attempts (including the first).
        base_delay: Initial sleep duration in seconds.
        backoff_factor: Multiplier applied to delay after each failure.
        exceptions: Exception types that trigger a retry.
    """

    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            delay = base_delay
            last_exc: Exception | None = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as exc:
                    last_exc = exc
                    if attempt == max_attempts:
                        break
                    logger.warning(
                        "%s failed (attempt %d/%d): %s — retrying in %.1fs",
                        func.__qualname__,
                        attempt,
                        max_attempts,
                        exc,
                        delay,
                    )
                    time.sleep(delay)
                    delay *= backoff_factor
            raise last_exc  # type: ignore[misc]

        return wrapper  # type: ignore[return-value]

    return decorator
