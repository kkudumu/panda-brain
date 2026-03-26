"""
db.py — SQLite database module for ftm-map.

Manages a 5-table schema (files, symbols, refs, file_edges, symbol_edges)
plus FTS5 for full-text search over symbols. Provides CRUD operations,
materialized edge rebuilding, and graph traversal queries.

Schema overview:
  files        — tracked source files with metadata
  symbols      — indexed code symbols (functions, classes, methods, etc.)
  refs         — unresolved references (calls, imports) keyed by symbol name
  file_edges   — materialized file-level dependency graph
  symbol_edges — materialized symbol-level dependency graph
  symbols_fts  — FTS5 virtual table for BM25-ranked search
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
CREATE TABLE IF NOT EXISTS files (
    id         INTEGER PRIMARY KEY,
    path       TEXT    NOT NULL UNIQUE,
    lang       TEXT,
    mtime      REAL    NOT NULL,
    hash       TEXT,
    line_count INTEGER
);

CREATE TABLE IF NOT EXISTS symbols (
    id             INTEGER PRIMARY KEY,
    file_id        INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL,
    qualified_name TEXT,
    kind           TEXT    NOT NULL,
    line_start     INTEGER NOT NULL,
    line_end       INTEGER,
    signature      TEXT,
    parent_id      INTEGER REFERENCES symbols(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS refs (
    id          INTEGER PRIMARY KEY,
    file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    symbol_name TEXT    NOT NULL,
    line        INTEGER NOT NULL,
    kind        TEXT    DEFAULT 'call'
);

CREATE TABLE IF NOT EXISTS file_edges (
    source_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    target_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    weight         REAL    DEFAULT 1.0,
    PRIMARY KEY (source_file_id, target_file_id)
);

CREATE TABLE IF NOT EXISTS symbol_edges (
    source_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    target_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
    kind             TEXT    NOT NULL,
    file_id          INTEGER REFERENCES files(id),
    line             INTEGER,
    PRIMARY KEY (source_symbol_id, target_symbol_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_symbols_file     ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name     ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_parent   ON symbols(parent_id);
CREATE INDEX IF NOT EXISTS idx_refs_file        ON refs(file_id);
CREATE INDEX IF NOT EXISTS idx_refs_symbol_name ON refs(symbol_name);
CREATE INDEX IF NOT EXISTS idx_file_edges_target ON file_edges(target_file_id);
CREATE INDEX IF NOT EXISTS idx_symbol_edges_target ON symbol_edges(target_symbol_id);

CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    name, qualified_name, signature,
    content=symbols, content_rowid=id,
    tokenize='porter'
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
# File CRUD
# ---------------------------------------------------------------------------


def add_file(
    conn: sqlite3.Connection,
    path: str,
    lang: str,
    mtime: float,
    hash: Optional[str] = None,
    line_count: Optional[int] = None,
) -> int:
    """Insert a file row. Returns the new file id."""
    cursor = conn.execute(
        """
        INSERT INTO files (path, lang, mtime, hash, line_count)
        VALUES (?, ?, ?, ?, ?)
        """,
        (path, lang, mtime, hash, line_count),
    )
    return cursor.lastrowid


def get_file_by_path(conn: sqlite3.Connection, path: str) -> Optional[dict]:
    """Return a file row as a dict, or None if not found."""
    row = conn.execute("SELECT * FROM files WHERE path=?", (path,)).fetchone()
    return dict(row) if row else None


def remove_file(conn: sqlite3.Connection, path: str) -> None:
    """Delete a file and cascade to symbols, refs, and edges.

    FTS5 rows are removed explicitly before the symbol rows because the
    content= table does not handle cascaded deletes automatically.
    """
    file_row = get_file_by_path(conn, path)
    if file_row is None:
        return

    file_id = file_row["id"]

    # Clean up FTS entries for symbols in this file
    sym_ids = [
        row["id"]
        for row in conn.execute("SELECT id FROM symbols WHERE file_id=?", (file_id,))
    ]
    for sid in sym_ids:
        conn.execute("DELETE FROM symbols_fts WHERE rowid=?", (sid,))

    # CASCADE handles symbols, refs, file_edges, symbol_edges
    conn.execute("DELETE FROM files WHERE id=?", (file_id,))


# ---------------------------------------------------------------------------
# Symbol CRUD
# ---------------------------------------------------------------------------


def add_symbol(
    conn: sqlite3.Connection,
    file_id: int,
    name: str,
    kind: str,
    line_start: int,
    line_end: Optional[int] = None,
    qualified_name: Optional[str] = None,
    signature: Optional[str] = None,
    parent_id: Optional[int] = None,
) -> int:
    """Insert a symbol row and keep the FTS5 index in sync.

    Returns the new symbol id.
    """
    cursor = conn.execute(
        """
        INSERT INTO symbols
            (file_id, name, qualified_name, kind, line_start, line_end, signature, parent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (file_id, name, qualified_name, kind, line_start, line_end, signature, parent_id),
    )
    symbol_id = cursor.lastrowid

    # FTS5 content= tables require manual insert so BM25 ranking stays accurate.
    conn.execute(
        "INSERT INTO symbols_fts(rowid, name, qualified_name, signature) VALUES (?, ?, ?, ?)",
        (symbol_id, name, qualified_name or "", signature or ""),
    )

    return symbol_id


def get_symbol_by_id(conn: sqlite3.Connection, symbol_id: int) -> Optional[dict]:
    """Return a symbol row as a dict, or None if not found."""
    row = conn.execute("SELECT * FROM symbols WHERE id=?", (symbol_id,)).fetchone()
    return dict(row) if row else None


def get_symbol_by_name(conn: sqlite3.Connection, name: str) -> list:
    """Return all symbols matching *name* (name is not guaranteed unique)."""
    rows = conn.execute("SELECT * FROM symbols WHERE name=?", (name,)).fetchall()
    return [dict(r) for r in rows]


def get_symbols_by_file(conn: sqlite3.Connection, file_id: int) -> list:
    """Return all symbols belonging to a given file."""
    rows = conn.execute(
        "SELECT * FROM symbols WHERE file_id=? ORDER BY line_start",
        (file_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def remove_symbols_by_file(conn: sqlite3.Connection, file_path: str) -> None:
    """Delete all symbols for a given file path.

    Finds the file_id from the path, cleans up FTS entries, then deletes
    the symbols (CASCADE handles symbol_edges).
    """
    file_row = get_file_by_path(conn, file_path)
    if file_row is None:
        return

    file_id = file_row["id"]

    # Clean up FTS entries
    sym_ids = [
        row["id"]
        for row in conn.execute("SELECT id FROM symbols WHERE file_id=?", (file_id,))
    ]
    for sid in sym_ids:
        conn.execute("DELETE FROM symbols_fts WHERE rowid=?", (sid,))

    conn.execute("DELETE FROM symbols WHERE file_id=?", (file_id,))


# ---------------------------------------------------------------------------
# Reference CRUD
# ---------------------------------------------------------------------------


def add_reference(
    conn: sqlite3.Connection,
    file_id: int,
    symbol_name: str,
    line: int,
    kind: str = "call",
) -> int:
    """Insert a reference row. Returns the new ref id."""
    cursor = conn.execute(
        "INSERT INTO refs (file_id, symbol_name, line, kind) VALUES (?, ?, ?, ?)",
        (file_id, symbol_name, line, kind),
    )
    return cursor.lastrowid


def get_references_by_file(conn: sqlite3.Connection, file_id: int) -> list:
    """Return all references in a given file."""
    rows = conn.execute(
        "SELECT * FROM refs WHERE file_id=? ORDER BY line",
        (file_id,),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Edge CRUD
# ---------------------------------------------------------------------------


def add_edge(
    conn: sqlite3.Connection,
    source_id: int,
    target_id: int,
    kind: str,
) -> None:
    """Insert a directed symbol edge. Silently ignored if the edge already exists."""
    conn.execute(
        "INSERT OR IGNORE INTO symbol_edges (source_symbol_id, target_symbol_id, kind) VALUES (?, ?, ?)",
        (source_id, target_id, kind),
    )


# ---------------------------------------------------------------------------
# Materialized edge rebuilding
# ---------------------------------------------------------------------------


def rebuild_file_edges(conn: sqlite3.Connection) -> None:
    """Rebuild the file_edges table from refs and symbols.

    For each ref in refs, finds which file defines a symbol with that name,
    then creates a file_edge from the referencing file to the defining file.
    Duplicate edges are collapsed; weight defaults to 1.0.
    """
    conn.execute("DELETE FROM file_edges")

    conn.execute(
        """
        INSERT OR IGNORE INTO file_edges (source_file_id, target_file_id, weight)
        SELECT DISTINCT r.file_id, s.file_id, 1.0
        FROM   refs r
        JOIN   symbols s ON s.name = r.symbol_name
        WHERE  r.file_id != s.file_id
        """
    )


def rebuild_symbol_edges(conn: sqlite3.Connection) -> None:
    """Rebuild the symbol_edges table from refs and symbols.

    For each ref, finds the target symbol (by name match) and the nearest
    enclosing definition in the referencing file (the symbol whose line range
    contains the ref line). Creates a symbol_edge from the enclosing symbol
    to the target symbol.
    """
    conn.execute("DELETE FROM symbol_edges")

    # Find matching ref -> target symbol, with nearest enclosing source symbol.
    # The enclosing symbol is the one in the same file as the ref whose
    # line_start <= ref.line and (line_end >= ref.line OR line_end IS NULL),
    # ordered by line_start DESC to get the nearest (innermost) enclosure.
    conn.execute(
        """
        INSERT OR IGNORE INTO symbol_edges (source_symbol_id, target_symbol_id, kind, file_id, line)
        SELECT src.id, tgt.id, r.kind, r.file_id, r.line
        FROM   refs r
        JOIN   symbols tgt ON tgt.name = r.symbol_name
        JOIN   symbols src ON src.file_id = r.file_id
                          AND src.line_start <= r.line
                          AND (src.line_end >= r.line OR src.line_end IS NULL)
        WHERE  src.id != tgt.id
        GROUP BY r.id, tgt.id
        HAVING src.line_start = MAX(src.line_start)
        """
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
    WITH RECURSIVE dep_chain(id, name, kind, file_id, depth, path) AS (
        -- Base: direct dependencies of the seed symbol
        SELECT s.id,
               s.name,
               s.kind,
               s.file_id,
               0,
               CAST(s.id AS TEXT)
        FROM   symbol_edges e
        JOIN   symbols s ON s.id = e.target_symbol_id
        WHERE  e.source_symbol_id = ?

        UNION ALL

        -- Recursive: dependencies of already-visited nodes
        SELECT s.id,
               s.name,
               s.kind,
               s.file_id,
               dc.depth + 1,
               dc.path || ',' || CAST(s.id AS TEXT)
        FROM   dep_chain dc
        JOIN   symbol_edges e ON e.source_symbol_id = dc.id
        JOIN   symbols s      ON s.id = e.target_symbol_id
        WHERE  dc.depth < ?
        AND    INSTR(dc.path, CAST(s.id AS TEXT)) = 0  -- cycle guard
    )
    SELECT DISTINCT id, name, kind, file_id, depth
    FROM   dep_chain
    ORDER  BY depth
    """
    rows = conn.execute(query, (symbol_id, max_depth)).fetchall()
    return [dict(r) for r in rows]


def get_reverse_deps(
    conn: sqlite3.Connection, symbol_id: int, max_depth: int = 10
) -> list:
    """Return all symbols that transitively depend on this symbol (blast radius).

    Traverses symbol_edges in reverse (callers/importers of the seed symbol).
    Same cycle-prevention strategy as get_transitive_deps.
    """
    query = """
    WITH RECURSIVE rev_chain(id, name, kind, file_id, depth, path) AS (
        -- Base: direct dependents of the seed symbol
        SELECT s.id,
               s.name,
               s.kind,
               s.file_id,
               0,
               CAST(s.id AS TEXT)
        FROM   symbol_edges e
        JOIN   symbols s ON s.id = e.source_symbol_id
        WHERE  e.target_symbol_id = ?

        UNION ALL

        -- Recursive: dependents of already-visited nodes
        SELECT s.id,
               s.name,
               s.kind,
               s.file_id,
               rc.depth + 1,
               rc.path || ',' || CAST(s.id AS TEXT)
        FROM   rev_chain rc
        JOIN   symbol_edges e ON e.target_symbol_id = rc.id
        JOIN   symbols s      ON s.id = e.source_symbol_id
        WHERE  rc.depth < ?
        AND    INSTR(rc.path, CAST(s.id AS TEXT)) = 0  -- cycle guard
    )
    SELECT DISTINCT id, name, kind, file_id, depth
    FROM   rev_chain
    ORDER  BY depth
    """
    rows = conn.execute(query, (symbol_id, max_depth)).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Full-text search
# ---------------------------------------------------------------------------


def fts_search(conn: sqlite3.Connection, query_text: str, limit: int = 10) -> list:
    """BM25-ranked full-text search over symbol names, qualified names, and signatures.

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
    file_count = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
    symbol_count = conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
    edge_count = conn.execute("SELECT COUNT(*) FROM symbol_edges").fetchone()[0]
    reference_count = conn.execute("SELECT COUNT(*) FROM refs").fetchone()[0]
    file_edge_count = conn.execute("SELECT COUNT(*) FROM file_edges").fetchone()[0]
    return {
        "file_count": file_count,
        "symbol_count": symbol_count,
        "edge_count": edge_count,
        "reference_count": reference_count,
        "file_edge_count": file_edge_count,
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

    print("Running db.py smoke tests ...")

    with tempfile.TemporaryDirectory() as tmp:
        conn = get_connection(tmp)

        # ---- add files ----
        fid_parser = add_file(conn, "src/parser.py", "python", 1000.0, hash="abc123", line_count=50)
        fid_lexer = add_file(conn, "src/lexer.py", "python", 1001.0, line_count=30)
        fid_index = add_file(conn, "src/index.py", "python", 1002.0)
        conn.commit()

        assert get_file_by_path(conn, "src/parser.py")["id"] == fid_parser, "get_file_by_path failed"
        assert get_file_by_path(conn, "nonexistent.py") is None, "get_file_by_path should return None"
        print("  [PASS] File CRUD")

        # ---- add symbols ----
        # parser.py: parse_file (lines 10-40)
        sid_parse = add_symbol(
            conn, fid_parser, "parse_file", "function", 10, line_end=40,
            qualified_name="parser.parse_file",
            signature="def parse_file(path: str) -> AST",
        )
        # lexer.py: tokenize (lines 1-20)
        sid_tokenize = add_symbol(
            conn, fid_lexer, "tokenize", "function", 1, line_end=20,
            qualified_name="lexer.tokenize",
            signature="def tokenize(src: str) -> list",
        )
        # index.py: build_index (lines 5-60) — calls parse_file and tokenize
        sid_build = add_symbol(
            conn, fid_index, "build_index", "function", 5, line_end=60,
            qualified_name="index.build_index",
            signature="def build_index(root: str) -> None",
        )
        conn.commit()

        assert get_symbol_by_id(conn, sid_parse)["name"] == "parse_file", "get_symbol_by_id failed"
        assert len(get_symbol_by_name(conn, "tokenize")) == 1, "get_symbol_by_name failed"
        assert len(get_symbols_by_file(conn, fid_parser)) == 1, "get_symbols_by_file failed"
        print("  [PASS] Symbol CRUD")

        # ---- add references ----
        # build_index calls parse_file at line 15 and tokenize at line 25
        ref1 = add_reference(conn, fid_index, "parse_file", 15, kind="call")
        ref2 = add_reference(conn, fid_index, "tokenize", 25, kind="call")
        # parse_file calls tokenize at line 20
        ref3 = add_reference(conn, fid_parser, "tokenize", 20, kind="call")
        conn.commit()

        refs_index = get_references_by_file(conn, fid_index)
        assert len(refs_index) == 2, f"expected 2 refs in index.py, got {len(refs_index)}"
        print("  [PASS] Reference CRUD")

        # ---- rebuild file edges ----
        rebuild_file_edges(conn)
        conn.commit()

        fe_count = conn.execute("SELECT COUNT(*) FROM file_edges").fetchone()[0]
        assert fe_count >= 2, f"expected >= 2 file edges, got {fe_count}"

        # index.py -> parser.py edge should exist
        fe = conn.execute(
            "SELECT * FROM file_edges WHERE source_file_id=? AND target_file_id=?",
            (fid_index, fid_parser),
        ).fetchone()
        assert fe is not None, "file edge index->parser missing"
        # index.py -> lexer.py edge should exist
        fe2 = conn.execute(
            "SELECT * FROM file_edges WHERE source_file_id=? AND target_file_id=?",
            (fid_index, fid_lexer),
        ).fetchone()
        assert fe2 is not None, "file edge index->lexer missing"
        print("  [PASS] rebuild_file_edges")

        # ---- rebuild symbol edges ----
        rebuild_symbol_edges(conn)
        conn.commit()

        se_count = conn.execute("SELECT COUNT(*) FROM symbol_edges").fetchone()[0]
        assert se_count >= 2, f"expected >= 2 symbol edges, got {se_count}"

        # build_index -> parse_file edge should exist
        se = conn.execute(
            "SELECT * FROM symbol_edges WHERE source_symbol_id=? AND target_symbol_id=?",
            (sid_build, sid_parse),
        ).fetchone()
        assert se is not None, "symbol edge build_index->parse_file missing"

        # build_index -> tokenize edge should exist
        se2 = conn.execute(
            "SELECT * FROM symbol_edges WHERE source_symbol_id=? AND target_symbol_id=?",
            (sid_build, sid_tokenize),
        ).fetchone()
        assert se2 is not None, "symbol edge build_index->tokenize missing"

        # parse_file -> tokenize edge should exist
        se3 = conn.execute(
            "SELECT * FROM symbol_edges WHERE source_symbol_id=? AND target_symbol_id=?",
            (sid_parse, sid_tokenize),
        ).fetchone()
        assert se3 is not None, "symbol edge parse_file->tokenize missing"
        print("  [PASS] rebuild_symbol_edges")

        # ---- transitive deps via symbol_edges ----
        deps = get_transitive_deps(conn, sid_build)
        dep_ids = {d["id"] for d in deps}
        assert sid_parse in dep_ids, f"transitive deps missing parse_file: {dep_ids}"
        assert sid_tokenize in dep_ids, f"transitive deps missing tokenize: {dep_ids}"
        print("  [PASS] get_transitive_deps")

        # ---- reverse deps via symbol_edges ----
        rdeps = get_reverse_deps(conn, sid_tokenize)
        rdep_ids = {d["id"] for d in rdeps}
        assert sid_parse in rdep_ids, f"reverse deps missing parse_file: {rdep_ids}"
        assert sid_build in rdep_ids, f"reverse deps missing build_index: {rdep_ids}"
        print("  [PASS] get_reverse_deps")

        # ---- FTS search ----
        results = fts_search(conn, "parse")
        assert any(r["name"] == "parse_file" for r in results), "FTS search for 'parse' failed"

        results_sig = fts_search(conn, "tokenize")
        assert any(r["name"] == "tokenize" for r in results_sig), "FTS search for 'tokenize' failed"

        results_qn = fts_search(conn, "index")
        assert any(r["name"] == "build_index" for r in results_qn), "FTS qualified_name search failed"
        print("  [PASS] FTS search")

        # ---- stats ----
        stats = get_stats(conn)
        assert stats["file_count"] == 3, f"expected 3 files, got {stats['file_count']}"
        assert stats["symbol_count"] == 3, f"expected 3 symbols, got {stats['symbol_count']}"
        assert stats["reference_count"] == 3, f"expected 3 refs, got {stats['reference_count']}"
        assert stats["edge_count"] >= 2, f"expected >= 2 symbol edges, got {stats['edge_count']}"
        assert stats["file_edge_count"] >= 2, f"expected >= 2 file edges, got {stats['file_edge_count']}"
        print("  [PASS] get_stats")

        # ---- add_edge (manual symbol edge) ----
        add_edge(conn, sid_parse, sid_build, "test_edge")
        conn.commit()
        manual_edge = conn.execute(
            "SELECT * FROM symbol_edges WHERE source_symbol_id=? AND target_symbol_id=? AND kind=?",
            (sid_parse, sid_build, "test_edge"),
        ).fetchone()
        assert manual_edge is not None, "add_edge failed"
        # duplicate should be ignored
        add_edge(conn, sid_parse, sid_build, "test_edge")
        conn.commit()
        print("  [PASS] add_edge (manual)")

        # ---- CASCADE deletes ----
        # Remove lexer.py file -> tokenize symbol, refs to tokenize, and edges should cascade
        sym_count_before = conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
        ref_count_before = conn.execute("SELECT COUNT(*) FROM refs").fetchone()[0]

        remove_file(conn, "src/lexer.py")
        conn.commit()

        assert get_file_by_path(conn, "src/lexer.py") is None, "file not removed"
        assert get_symbol_by_id(conn, sid_tokenize) is None, "symbol not cascaded on file delete"

        sym_count_after = conn.execute("SELECT COUNT(*) FROM symbols").fetchone()[0]
        assert sym_count_after == sym_count_before - 1, f"expected {sym_count_before - 1} symbols, got {sym_count_after}"

        # Refs in lexer.py should be gone (there were none, but verify no error)
        # Symbol edges involving tokenize should be gone
        edges_to_tokenize = conn.execute(
            "SELECT COUNT(*) FROM symbol_edges WHERE target_symbol_id=? OR source_symbol_id=?",
            (sid_tokenize, sid_tokenize),
        ).fetchone()[0]
        assert edges_to_tokenize == 0, f"expected 0 edges involving deleted symbol, got {edges_to_tokenize}"
        print("  [PASS] CASCADE deletes (remove_file)")

        # ---- remove_symbols_by_file (without removing file) ----
        remove_symbols_by_file(conn, "src/parser.py")
        conn.commit()
        assert get_symbol_by_id(conn, sid_parse) is None, "remove_symbols_by_file failed"
        # File itself should still exist
        assert get_file_by_path(conn, "src/parser.py") is not None, "file should still exist after remove_symbols_by_file"
        print("  [PASS] remove_symbols_by_file")

        # ---- final stats ----
        final_stats = get_stats(conn)
        print(f"\n  Final stats: {final_stats}")

        # ---- hash_content utility ----
        h = hash_content("hello world")
        assert len(h) == 64, "hash_content should return 64-char hex string"
        assert h == hash_content("hello world"), "hash_content should be deterministic"
        print("  [PASS] hash_content")

        print("\nAll smoke tests passed.")
