"""
db.py — SQLite database module for ftm-map.

Manages the symbols/edges/FTS5 schema and provides CRUD operations for the
code graph. This is a library module — import it from index.py, query.py,
and views.py.

Schema overview:
  symbols      — indexed code symbols (functions, classes, methods, etc.)
  edges        — directed dependency relationships between symbols
  symbols_fts  — FTS5 virtual table for full-text search (BM25-ranked)
"""

import hashlib
import os
import sqlite3
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DB_DIR = ".ftm-map"
DB_PATH = os.path.join(DB_DIR, "map.db")

# ---------------------------------------------------------------------------
# Schema DDL
# ---------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS symbols (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    kind         TEXT    NOT NULL,   -- 'function','class','method','variable','import','module'
    file_path    TEXT    NOT NULL,
    start_line   INTEGER,
    end_line     INTEGER,
    signature    TEXT,
    doc_comment  TEXT,
    content_hash TEXT                -- hash of symbol body for change detection
);

CREATE TABLE IF NOT EXISTS edges (
    source_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    kind      TEXT    NOT NULL,      -- 'calls','imports','extends','implements','uses'
    PRIMARY KEY (source_id, target_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_symbols_file  ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name  ON symbols(name);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    name, signature, doc_comment, file_path,
    content=symbols, content_rowid=id
);
"""

# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------


def get_connection(project_root: str) -> sqlite3.Connection:
    """Return a connection to the project's map database.

    Creates .ftm-map/ and initialises the schema if they do not exist yet.
    WAL mode is enabled for concurrent readers; foreign-key enforcement is on.
    """
    db_path = os.path.join(project_root, DB_PATH)
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row

    _init_schema(conn)
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    """Create tables, indexes, and FTS5 virtual table if they do not exist."""
    conn.executescript(_SCHEMA)
    conn.commit()


# ---------------------------------------------------------------------------
# Symbol CRUD
# ---------------------------------------------------------------------------


def add_symbol(
    conn: sqlite3.Connection,
    name: str,
    kind: str,
    file_path: str,
    start_line: Optional[int],
    end_line: Optional[int],
    signature: Optional[str] = None,
    doc_comment: Optional[str] = None,
    content_hash: Optional[str] = None,
) -> int:
    """Insert a symbol row and keep the FTS5 index in sync.

    Returns the new symbol id.
    """
    cursor = conn.execute(
        """
        INSERT INTO symbols
            (name, kind, file_path, start_line, end_line, signature, doc_comment, content_hash)
        VALUES (?,?,?,?,?,?,?,?)
        """,
        (name, kind, file_path, start_line, end_line, signature, doc_comment, content_hash),
    )
    symbol_id = cursor.lastrowid

    # FTS5 content= tables require manual insert so BM25 ranking stays accurate.
    conn.execute(
        "INSERT INTO symbols_fts(rowid, name, signature, doc_comment, file_path) VALUES (?,?,?,?,?)",
        (symbol_id, name, signature or "", doc_comment or "", file_path),
    )

    return symbol_id


def remove_symbols_by_file(conn: sqlite3.Connection, file_path: str) -> None:
    """Delete all symbols (and their edges) for a given file.

    FTS5 rows are removed explicitly before the symbol rows because the
    content= table does not handle cascaded deletes automatically.
    ON DELETE CASCADE handles edge cleanup via the symbols foreign key.
    """
    ids = [
        row["id"]
        for row in conn.execute("SELECT id FROM symbols WHERE file_path=?", (file_path,))
    ]
    for sid in ids:
        conn.execute("DELETE FROM symbols_fts WHERE rowid=?", (sid,))

    conn.execute("DELETE FROM symbols WHERE file_path=?", (file_path,))


def get_symbol_by_id(conn: sqlite3.Connection, symbol_id: int) -> Optional[dict]:
    """Return a symbol row as a dict, or None if not found."""
    row = conn.execute("SELECT * FROM symbols WHERE id=?", (symbol_id,)).fetchone()
    return dict(row) if row else None


def get_symbol_by_name(conn: sqlite3.Connection, name: str) -> list:
    """Return all symbols matching *name* (name is not guaranteed unique)."""
    rows = conn.execute("SELECT * FROM symbols WHERE name=?", (name,)).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Edge CRUD
# ---------------------------------------------------------------------------


def add_edge(conn: sqlite3.Connection, source_id: int, target_id: int, kind: str) -> None:
    """Insert a directed edge. Silently ignored if the edge already exists."""
    conn.execute(
        "INSERT OR IGNORE INTO edges (source_id, target_id, kind) VALUES (?,?,?)",
        (source_id, target_id, kind),
    )


# ---------------------------------------------------------------------------
# Graph traversal — recursive CTEs
# ---------------------------------------------------------------------------


def get_transitive_deps(
    conn: sqlite3.Connection, symbol_id: int, max_depth: int = 10
) -> list:
    """Return all symbols this symbol transitively depends on (forward closure).

    Cycle prevention is handled by tracking visited ids as a comma-separated
    path string inside the CTE; a node is skipped if its id already appears in
    the path string.

    Results are ordered by traversal depth (shallowest first) and deduplicated.
    """
    query = """
    WITH RECURSIVE dep_chain(id, name, kind, file_path, depth, path) AS (
        -- Base: direct dependencies of the seed symbol
        SELECT s.id,
               s.name,
               s.kind,
               s.file_path,
               0,
               CAST(s.id AS TEXT)
        FROM   edges e
        JOIN   symbols s ON s.id = e.target_id
        WHERE  e.source_id = ?

        UNION ALL

        -- Recursive: dependencies of already-visited nodes
        SELECT s.id,
               s.name,
               s.kind,
               s.file_path,
               dc.depth + 1,
               dc.path || ',' || CAST(s.id AS TEXT)
        FROM   dep_chain dc
        JOIN   edges e   ON e.source_id = dc.id
        JOIN   symbols s ON s.id = e.target_id
        WHERE  dc.depth < ?
        AND    INSTR(dc.path, CAST(s.id AS TEXT)) = 0  -- cycle guard
    )
    SELECT DISTINCT id, name, kind, file_path, depth
    FROM   dep_chain
    ORDER  BY depth
    """
    rows = conn.execute(query, (symbol_id, max_depth)).fetchall()
    return [dict(r) for r in rows]


def get_reverse_deps(
    conn: sqlite3.Connection, symbol_id: int, max_depth: int = 10
) -> list:
    """Return all symbols that transitively depend on this symbol (blast radius).

    Traverses edges in reverse (callers/importers of the seed symbol).
    Same cycle-prevention strategy as get_transitive_deps.
    """
    query = """
    WITH RECURSIVE rev_chain(id, name, kind, file_path, depth, path) AS (
        -- Base: direct dependents of the seed symbol
        SELECT s.id,
               s.name,
               s.kind,
               s.file_path,
               0,
               CAST(s.id AS TEXT)
        FROM   edges e
        JOIN   symbols s ON s.id = e.source_id
        WHERE  e.target_id = ?

        UNION ALL

        -- Recursive: dependents of already-visited nodes
        SELECT s.id,
               s.name,
               s.kind,
               s.file_path,
               rc.depth + 1,
               rc.path || ',' || CAST(s.id AS TEXT)
        FROM   rev_chain rc
        JOIN   edges e   ON e.target_id = rc.id
        JOIN   symbols s ON s.id = e.source_id
        WHERE  rc.depth < ?
        AND    INSTR(rc.path, CAST(s.id AS TEXT)) = 0  -- cycle guard
    )
    SELECT DISTINCT id, name, kind, file_path, depth
    FROM   rev_chain
    ORDER  BY depth
    """
    rows = conn.execute(query, (symbol_id, max_depth)).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Full-text search
# ---------------------------------------------------------------------------


def fts_search(conn: sqlite3.Connection, query_text: str, limit: int = 10) -> list:
    """BM25-ranked full-text search over symbol names, signatures, and doc comments.

    Returns up to *limit* symbol dicts with an additional 'rank' field.
    Lower rank values indicate better matches (BM25 scores are negative in
    SQLite's fts5 implementation).
    """
    query = """
    SELECT s.*, fts.rank
    FROM   symbols_fts fts
    JOIN   symbols s ON s.id = fts.rowid
    WHERE  symbols_fts MATCH ?
    ORDER  BY fts.rank
    LIMIT  ?
    """
    rows = conn.execute(query, (query_text, limit)).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------


def get_stats(conn: sqlite3.Connection) -> dict:
    """Return high-level database statistics."""
    symbols_count = conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
    edges_count = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    files_count = conn.execute(
        "SELECT COUNT(DISTINCT file_path) FROM symbols"
    ).fetchone()[0]
    return {
        "symbols": symbols_count,
        "edges": edges_count,
        "files": files_count,
    }


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def hash_content(content: str) -> str:
    """Return a SHA-256 hex digest for *content*. Useful for change detection."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Smoke-test entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import tempfile

    print("Running db.py smoke tests …")

    with tempfile.TemporaryDirectory() as tmp:
        conn = get_connection(tmp)

        # ---- symbols ----
        sid_a = add_symbol(
            conn, "parse_file", "function", "src/parser.py", 10, 40,
            signature="def parse_file(path: str) -> AST",
            doc_comment="Parse a source file and return its AST.",
            content_hash=hash_content("def parse_file(): pass"),
        )
        sid_b = add_symbol(
            conn, "tokenize", "function", "src/lexer.py", 1, 20,
            signature="def tokenize(src: str) -> list",
        )
        sid_c = add_symbol(
            conn, "build_index", "function", "src/index.py", 5, 60,
            signature="def build_index(root: str) -> None",
            doc_comment="Build the code graph index for a project.",
        )

        assert get_symbol_by_id(conn, sid_a)["name"] == "parse_file", "get_symbol_by_id failed"
        assert len(get_symbol_by_name(conn, "tokenize")) == 1, "get_symbol_by_name failed"

        # ---- edges ----
        # build_index → parse_file → tokenize
        add_edge(conn, sid_c, sid_a, "calls")
        add_edge(conn, sid_a, sid_b, "calls")
        add_edge(conn, sid_c, sid_a, "calls")  # duplicate — should be ignored

        conn.commit()

        # ---- transitive deps ----
        deps = get_transitive_deps(conn, sid_c)
        dep_ids = {d["id"] for d in deps}
        assert sid_a in dep_ids and sid_b in dep_ids, f"transitive deps wrong: {dep_ids}"

        # ---- reverse deps ----
        rdeps = get_reverse_deps(conn, sid_b)
        rdep_ids = {d["id"] for d in rdeps}
        assert sid_a in rdep_ids and sid_c in rdep_ids, f"reverse deps wrong: {rdep_ids}"

        # ---- FTS search ----
        results = fts_search(conn, "parse")
        assert any(r["name"] == "parse_file" for r in results), "FTS search failed"

        results_doc = fts_search(conn, "index")
        assert any(r["name"] == "build_index" for r in results_doc), "FTS doc_comment search failed"

        # ---- remove by file ----
        remove_symbols_by_file(conn, "src/lexer.py")
        conn.commit()
        assert get_symbol_by_id(conn, sid_b) is None, "remove_symbols_by_file failed"

        # ---- stats ----
        stats = get_stats(conn)
        assert stats["symbols"] == 2, f"expected 2 symbols after removal, got {stats['symbols']}"
        assert stats["files"] == 2, f"expected 2 files, got {stats['files']}"
        # edge from parse_file → tokenize should be gone via CASCADE
        edge_count = conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
        assert edge_count == 1, f"expected 1 edge after file removal, got {edge_count}"

        print("All smoke tests passed.")
        print(f"Stats: {get_stats(conn)}")
