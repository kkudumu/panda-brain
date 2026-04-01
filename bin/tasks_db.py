"""Shared task management module backed by SQLite.

All consumers should ``from tasks_db import …`` to interact with the
eng-buddy task database.  The schema is created lazily on the first
call to :func:`get_conn`.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

DB_PATH: Path = Path.home() / ".claude" / "eng-buddy" / "tasks.db"

_schema_ensured: bool = False

# ---------------------------------------------------------------------------
# Priority helpers
# ---------------------------------------------------------------------------

_PRIORITY_ORDER_EXPR = """
    CASE priority
        WHEN 'high'   THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low'    THEN 3
        ELSE 4
    END
"""

_JIRA_PRIORITY_MAP: Dict[str, str] = {
    "highest": "high",
    "high": "high",
    "medium": "medium",
    "low": "low",
    "lowest": "low",
}

# ---------------------------------------------------------------------------
# Connection & schema
# ---------------------------------------------------------------------------


def get_conn() -> sqlite3.Connection:
    """Return a connection with Row factory, WAL mode, and foreign keys ON.

    On the first call the schema is created automatically via
    :func:`ensure_schema`.
    """
    global _schema_ensured

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    if not _schema_ensured:
        ensure_schema(conn)
        _schema_ensured = True

    return conn


def ensure_schema(conn: Optional[sqlite3.Connection] = None) -> None:
    """Idempotently create all tables, indexes, triggers and FTS index."""
    own_conn = conn is None
    if own_conn:
        conn = get_conn()

    cur = conn.cursor()

    # -- core tables ---------------------------------------------------------
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            jira_key        TEXT UNIQUE,
            freshservice_url TEXT,
            title           TEXT NOT NULL,
            description     TEXT,
            status          TEXT NOT NULL DEFAULT 'pending',
            priority        TEXT NOT NULL DEFAULT 'medium',
            jira_status     TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at    TEXT,
            deferred_until  TEXT,
            metadata        TEXT DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status
            ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_jira_key
            ON tasks(jira_key) WHERE jira_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_tasks_priority
            ON tasks(priority, status);

        CREATE TABLE IF NOT EXISTS task_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            event_type  TEXT NOT NULL,
            detail      TEXT,
            actor       TEXT NOT NULL DEFAULT 'system',
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_task_events_task
            ON task_events(task_id, created_at);
        """
    )

    # -- FTS5 virtual table --------------------------------------------------
    # executescript cannot handle virtual-table DDL reliably; use execute.
    cur.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
            title, description, jira_key, metadata,
            content='tasks', content_rowid='id'
        )
        """
    )

    # -- FTS sync triggers ---------------------------------------------------
    cur.executescript(
        """
        CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
            INSERT INTO tasks_fts(rowid, title, description, jira_key, metadata)
            VALUES (new.id, new.title, new.description, new.jira_key, new.metadata);
        END;

        CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
            INSERT INTO tasks_fts(tasks_fts, rowid, title, description, jira_key, metadata)
            VALUES ('delete', old.id, old.title, old.description, old.jira_key, old.metadata);
        END;

        CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
            INSERT INTO tasks_fts(tasks_fts, rowid, title, description, jira_key, metadata)
            VALUES ('delete', old.id, old.title, old.description, old.jira_key, old.metadata);
            INSERT INTO tasks_fts(rowid, title, description, jira_key, metadata)
            VALUES (new.id, new.title, new.description, new.jira_key, new.metadata);
        END;
        """
    )

    conn.commit()

    if own_conn:
        conn.close()


# ---------------------------------------------------------------------------
# Row helpers
# ---------------------------------------------------------------------------

def task_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a ``sqlite3.Row`` to a plain dict, parsing metadata JSON."""
    d = dict(row)
    raw = d.get("metadata")
    if isinstance(raw, str):
        try:
            d["metadata"] = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            d["metadata"] = {}
    return d


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def list_tasks(
    status: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """List tasks, optionally filtered by *status*.

    Ordering: priority DESC (high first), then created_at ASC.
    """
    conn = get_conn()
    try:
        sql = f"SELECT * FROM tasks"
        params: list[Any] = []
        if status is not None:
            sql += " WHERE status = ?"
            params.append(status)
        sql += f" ORDER BY {_PRIORITY_ORDER_EXPR}, created_at ASC LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
        return [task_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_task(task_id: int) -> Optional[Dict[str, Any]]:
    """Get a single task by its local ID."""
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return task_to_dict(row) if row else None
    finally:
        conn.close()


def get_task_by_jira_key(jira_key: str) -> Optional[Dict[str, Any]]:
    """Lookup a task by its Jira key."""
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM tasks WHERE jira_key = ?", (jira_key,)
        ).fetchone()
        return task_to_dict(row) if row else None
    finally:
        conn.close()


def add_task(
    title: str,
    description: Optional[str] = None,
    priority: str = "medium",
    jira_key: Optional[str] = None,
    freshservice_url: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> int:
    """Insert a new task and record a 'created' event. Returns the new ID."""
    meta_str = json.dumps(metadata or {})
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO tasks (title, description, priority, jira_key,
                               freshservice_url, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (title, description, priority, jira_key, freshservice_url, meta_str),
        )
        task_id = cur.lastrowid
        conn.execute(
            """
            INSERT INTO task_events (task_id, event_type, detail, actor)
            VALUES (?, 'created', ?, 'system')
            """,
            (task_id, f"Task created: {title}"),
        )
        conn.commit()
        return task_id
    finally:
        conn.close()


_VALID_TASK_FIELDS = {
    "title",
    "description",
    "status",
    "priority",
    "jira_key",
    "jira_status",
    "freshservice_url",
    "completed_at",
    "deferred_until",
    "metadata",
}


def update_task(task_id: int, **fields: Any) -> bool:
    """Update arbitrary valid fields on a task.

    Automatically sets ``updated_at``, records an 'updated' event, and
    sets ``completed_at`` when *status* changes to ``'completed'``.

    Returns ``True`` if a row was updated, ``False`` otherwise.
    """
    invalid = set(fields) - _VALID_TASK_FIELDS
    if invalid:
        raise ValueError(f"Invalid task fields: {invalid}")
    if not fields:
        return False

    # Serialise metadata if present
    if "metadata" in fields and not isinstance(fields["metadata"], str):
        fields["metadata"] = json.dumps(fields["metadata"])

    conn = get_conn()
    try:
        # Handle completed_at automatically
        if fields.get("status") == "completed" and "completed_at" not in fields:
            fields["completed_at"] = "datetime('now')"

        set_clauses: list[str] = []
        params: list[Any] = []
        for key, val in fields.items():
            if key == "completed_at" and val == "datetime('now')":
                set_clauses.append("completed_at = datetime('now')")
            else:
                set_clauses.append(f"{key} = ?")
                params.append(val)

        set_clauses.append("updated_at = datetime('now')")
        params.append(task_id)

        sql = f"UPDATE tasks SET {', '.join(set_clauses)} WHERE id = ?"
        cur = conn.execute(sql, params)

        if cur.rowcount == 0:
            return False

        changed = ", ".join(f"{k}={v!r}" for k, v in fields.items())
        conn.execute(
            """
            INSERT INTO task_events (task_id, event_type, detail, actor)
            VALUES (?, 'updated', ?, 'system')
            """,
            (task_id, f"Fields changed: {changed}"),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def upsert_jira_task(
    jira_key: str,
    title: str,
    jira_status: str,
    priority: str,
    metadata: Optional[dict] = None,
) -> int:
    """Insert or update a task keyed by *jira_key*.

    On conflict the Jira status and priority are updated but user-edited
    title/description are preserved.  If the Jira status maps to ``Done``
    the local status is set to ``'completed'``.

    Returns the task ID.
    """
    mapped_priority = _JIRA_PRIORITY_MAP.get(priority.lower(), "medium")
    meta_str = json.dumps(metadata or {})
    is_done = jira_status.lower() == "done"

    conn = get_conn()
    try:
        existing = conn.execute(
            "SELECT * FROM tasks WHERE jira_key = ?", (jira_key,)
        ).fetchone()

        if existing is None:
            # Insert new
            status = "completed" if is_done else "pending"
            cur = conn.execute(
                """
                INSERT INTO tasks (title, jira_key, jira_status, priority,
                                   status, metadata)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (title, jira_key, jira_status, mapped_priority, status, meta_str),
            )
            task_id = cur.lastrowid
            conn.execute(
                """
                INSERT INTO task_events (task_id, event_type, detail, actor)
                VALUES (?, 'created', ?, 'jira-sync')
                """,
                (task_id, f"Synced from Jira: {jira_key}"),
            )
            if is_done:
                conn.execute(
                    "UPDATE tasks SET completed_at = datetime('now') WHERE id = ?",
                    (task_id,),
                )
            conn.commit()
            return task_id
        else:
            # Update existing — preserve user-edited title/description
            task_id = existing["id"]
            update_parts = [
                "jira_status = ?",
                "priority = ?",
                "updated_at = datetime('now')",
            ]
            params: list[Any] = [jira_status, mapped_priority]

            if is_done and existing["status"] != "completed":
                update_parts.append("status = 'completed'")
                update_parts.append("completed_at = datetime('now')")

            params.append(task_id)
            conn.execute(
                f"UPDATE tasks SET {', '.join(update_parts)} WHERE id = ?",
                params,
            )
            conn.execute(
                """
                INSERT INTO task_events (task_id, event_type, detail, actor)
                VALUES (?, 'updated', ?, 'jira-sync')
                """,
                (
                    task_id,
                    f"Jira sync: status={jira_status}, priority={mapped_priority}",
                ),
            )
            conn.commit()
            return task_id
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def search_tasks(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Full-text search across tasks using FTS5."""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT t.*
            FROM tasks_fts fts
            JOIN tasks t ON t.id = fts.rowid
            WHERE tasks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (query, limit),
        ).fetchall()
        return [task_to_dict(r) for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def record_event(
    task_id: int,
    event_type: str,
    detail: Optional[str] = None,
    actor: str = "system",
) -> int:
    """Insert a row into ``task_events`` and return its ID."""
    conn = get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO task_events (task_id, event_type, detail, actor)
            VALUES (?, ?, ?, ?)
            """,
            (task_id, event_type, detail, actor),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()
