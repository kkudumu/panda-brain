"""
SQLite connection helper for ftm-inbox.

Uses WAL journal mode for better read concurrency and sets a sensible
busy timeout so concurrent writer contention fails gracefully rather
than immediately.
"""

import sqlite3
import threading
from pathlib import Path

_local = threading.local()

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / "ftm-inbox.db"


def get_connection(db_path: Path | None = None) -> sqlite3.Connection:
    """
    Return a thread-local SQLite connection.

    The connection is configured with:
      - WAL journal mode for concurrent reads during writes
      - 5-second busy timeout to handle writer contention
      - Row factory set to sqlite3.Row for dict-like access
      - Foreign keys enabled
    """
    path = db_path or DEFAULT_DB_PATH

    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = _open_connection(path)

    return _local.conn


def _open_connection(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row

    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.commit()

    return conn


def close_connection() -> None:
    """Close the thread-local connection if open."""
    if hasattr(_local, "conn") and _local.conn is not None:
        _local.conn.close()
        _local.conn = None
