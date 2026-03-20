"""
SQLite schema definitions for ftm-inbox.

Tables:
  - inbox       : normalized items from all pollers
  - events      : raw event log from all sources
  - plans       : structured YAML plans linked to inbox tasks
  - audit_log   : immutable record of every mutation performed by the executor
"""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS inbox (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    body            TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'open',
    priority        TEXT NOT NULL DEFAULT 'medium',
    assignee        TEXT,
    requester       TEXT,
    created_at      TEXT,
    updated_at      TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    custom_fields   TEXT NOT NULL DEFAULT '{}',
    raw_payload     TEXT NOT NULL DEFAULT '{}',
    source_url      TEXT,
    content_hash    TEXT NOT NULL UNIQUE,
    ingested_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbox_source ON inbox(source);
CREATE INDEX IF NOT EXISTS idx_inbox_status ON inbox(status);
CREATE INDEX IF NOT EXISTS idx_inbox_content_hash ON inbox(content_hash);

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

CREATE TABLE IF NOT EXISTS plans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER NOT NULL REFERENCES inbox(id) ON DELETE CASCADE,
    yaml_content    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plans_task_id ON plans(task_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);

CREATE TABLE IF NOT EXISTS audit_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    step_id             TEXT NOT NULL,
    action_type         TEXT NOT NULL,
    target_system       TEXT NOT NULL,
    target_object       TEXT NOT NULL,
    mutation_performed  TEXT NOT NULL,
    result              TEXT NOT NULL DEFAULT '{}',
    rollback_available  INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_step_id ON audit_log(step_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_type ON audit_log(action_type);
"""


def initialize_schema(conn) -> None:
    """Execute all CREATE TABLE and CREATE INDEX statements."""
    conn.executescript(SCHEMA_SQL)
    conn.commit()
