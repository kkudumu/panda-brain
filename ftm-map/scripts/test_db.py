"""Tests for db.py -- 5-table schema with FTS5."""
import os
import sys
import tempfile
import pytest

sys.path.insert(0, os.path.dirname(__file__))
from db import (
    get_connection,
    add_file,
    get_file_by_path,
    remove_file,
    add_symbol,
    get_symbol_by_id,
    get_symbol_by_name,
    get_symbols_by_file,
    add_reference,
    get_references_by_file,
    rebuild_file_edges,
    rebuild_symbol_edges,
    add_edge,
    get_transitive_deps,
    get_reverse_deps,
    fts_search,
    get_stats,
    hash_content,
    remove_symbols_by_file,
)


@pytest.fixture
def conn():
    with tempfile.TemporaryDirectory() as tmp:
        c = get_connection(tmp)
        yield c
        c.close()


@pytest.fixture
def populated_conn(conn):
    """Conn with 3 files, symbols, and references for graph tests."""
    f1 = add_file(conn, "src/auth.py", "python", 1.0, line_count=50)
    f2 = add_file(conn, "src/api.py", "python", 1.0, line_count=100)
    f3 = add_file(conn, "src/utils.py", "python", 1.0, line_count=30)

    s1 = add_symbol(conn, f1, "authenticate", "function", 1, 20, signature="def authenticate(req)")
    s2 = add_symbol(conn, f1, "verify_token", "function", 25, 40)
    s3 = add_symbol(conn, f2, "handle_request", "function", 1, 50)
    s4 = add_symbol(conn, f3, "format_date", "function", 1, 10)

    # api.py references authenticate (defined in auth.py) and format_date (defined in utils.py)
    add_reference(conn, f2, "authenticate", 10)
    add_reference(conn, f2, "format_date", 20)
    # auth.py references format_date (defined in utils.py)
    add_reference(conn, f1, "format_date", 30)

    conn.commit()
    return conn, {"f1": f1, "f2": f2, "f3": f3, "s1": s1, "s2": s2, "s3": s3, "s4": s4}


class TestFileCRUD:
    def test_add_and_get(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0, hash="abc123", line_count=100)
        assert fid > 0
        row = get_file_by_path(conn, "src/main.py")
        assert row is not None
        assert row["lang"] == "python"
        assert row["hash"] == "abc123"
        assert row["line_count"] == 100

    def test_unique_path(self, conn):
        add_file(conn, "src/main.py", "python", 1.0)
        with pytest.raises(Exception):
            add_file(conn, "src/main.py", "python", 2.0)

    def test_get_nonexistent(self, conn):
        assert get_file_by_path(conn, "nonexistent.py") is None

    def test_remove_file(self, conn):
        add_file(conn, "src/main.py", "python", 1.0)
        conn.commit()
        remove_file(conn, "src/main.py")
        conn.commit()
        assert get_file_by_path(conn, "src/main.py") is None

    def test_remove_nonexistent_is_noop(self, conn):
        # Should not raise
        remove_file(conn, "nonexistent.py")

    def test_remove_cascades(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        add_symbol(conn, fid, "foo", "function", 1, 10)
        add_reference(conn, fid, "bar", 5)
        conn.commit()
        remove_file(conn, "src/main.py")
        conn.commit()
        assert get_file_by_path(conn, "src/main.py") is None
        assert len(get_symbols_by_file(conn, fid)) == 0
        assert len(get_references_by_file(conn, fid)) == 0


class TestSymbolCRUD:
    def test_add_and_get(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        sid = add_symbol(conn, fid, "my_func", "function", 10, 30, signature="def my_func()")
        sym = get_symbol_by_id(conn, sid)
        assert sym["name"] == "my_func"
        assert sym["kind"] == "function"
        assert sym["signature"] == "def my_func()"

    def test_get_by_name(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        add_symbol(conn, fid, "my_func", "function", 10, 30)
        results = get_symbol_by_name(conn, "my_func")
        assert len(results) == 1
        assert results[0]["name"] == "my_func"

    def test_get_by_name_multiple_matches(self, conn):
        f1 = add_file(conn, "src/a.py", "python", 1.0)
        f2 = add_file(conn, "src/b.py", "python", 1.0)
        add_symbol(conn, f1, "init", "function", 1, 10)
        add_symbol(conn, f2, "init", "function", 1, 10)
        results = get_symbol_by_name(conn, "init")
        assert len(results) == 2

    def test_get_by_file(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        add_symbol(conn, fid, "foo", "function", 1, 10)
        add_symbol(conn, fid, "bar", "class", 15, 30)
        syms = get_symbols_by_file(conn, fid)
        assert len(syms) == 2

    def test_get_by_file_ordered(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        add_symbol(conn, fid, "second", "function", 20, 30)
        add_symbol(conn, fid, "first", "function", 1, 10)
        syms = get_symbols_by_file(conn, fid)
        assert syms[0]["name"] == "first"
        assert syms[1]["name"] == "second"

    def test_parent_id(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        parent = add_symbol(conn, fid, "MyClass", "class", 1, 50)
        child = add_symbol(conn, fid, "my_method", "method", 5, 20, parent_id=parent)
        sym = get_symbol_by_id(conn, child)
        assert sym["parent_id"] == parent

    def test_qualified_name(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        sid = add_symbol(conn, fid, "func", "function", 1, 10, qualified_name="main.func")
        sym = get_symbol_by_id(conn, sid)
        assert sym["qualified_name"] == "main.func"


class TestReferenceCRUD:
    def test_add_and_get(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        add_reference(conn, fid, "some_func", 42, kind="call")
        refs = get_references_by_file(conn, fid)
        assert len(refs) == 1
        assert refs[0]["symbol_name"] == "some_func"
        assert refs[0]["line"] == 42
        assert refs[0]["kind"] == "call"

    def test_default_kind(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        add_reference(conn, fid, "func", 10)
        refs = get_references_by_file(conn, fid)
        assert refs[0]["kind"] == "call"

    def test_multiple_refs_ordered(self, conn):
        fid = add_file(conn, "src/main.py", "python", 1.0)
        add_reference(conn, fid, "b_func", 20)
        add_reference(conn, fid, "a_func", 5)
        refs = get_references_by_file(conn, fid)
        assert refs[0]["line"] == 5
        assert refs[1]["line"] == 20


class TestEdgeRebuilding:
    def test_rebuild_file_edges(self, populated_conn):
        conn, ids = populated_conn
        rebuild_file_edges(conn)
        conn.commit()
        edges = conn.execute("SELECT * FROM file_edges").fetchall()
        # api.py -> auth.py (authenticate), api.py -> utils.py (format_date),
        # auth.py -> utils.py (format_date)
        assert len(edges) >= 2

    def test_rebuild_file_edges_no_self_edges(self, populated_conn):
        conn, ids = populated_conn
        rebuild_file_edges(conn)
        conn.commit()
        self_edges = conn.execute(
            "SELECT * FROM file_edges WHERE source_file_id = target_file_id"
        ).fetchall()
        assert len(self_edges) == 0

    def test_rebuild_symbol_edges(self, populated_conn):
        conn, ids = populated_conn
        rebuild_symbol_edges(conn)
        conn.commit()
        edges = conn.execute("SELECT * FROM symbol_edges").fetchall()
        assert len(edges) >= 1

    def test_rebuild_is_idempotent(self, populated_conn):
        conn, ids = populated_conn
        rebuild_file_edges(conn)
        rebuild_symbol_edges(conn)
        conn.commit()
        count1 = conn.execute("SELECT COUNT(*) FROM file_edges").fetchone()[0]
        count2 = conn.execute("SELECT COUNT(*) FROM symbol_edges").fetchone()[0]

        rebuild_file_edges(conn)
        rebuild_symbol_edges(conn)
        conn.commit()
        assert conn.execute("SELECT COUNT(*) FROM file_edges").fetchone()[0] == count1
        assert conn.execute("SELECT COUNT(*) FROM symbol_edges").fetchone()[0] == count2


class TestGraphTraversal:
    def test_transitive_deps(self, populated_conn):
        conn, ids = populated_conn
        rebuild_symbol_edges(conn)
        conn.commit()
        deps = get_transitive_deps(conn, ids["s3"])  # handle_request
        dep_names = {d["name"] for d in deps}
        # handle_request refs authenticate and format_date
        assert "authenticate" in dep_names or "format_date" in dep_names

    def test_reverse_deps(self, populated_conn):
        conn, ids = populated_conn
        rebuild_symbol_edges(conn)
        conn.commit()
        rdeps = get_reverse_deps(conn, ids["s1"])  # authenticate
        rdep_names = {d["name"] for d in rdeps}
        assert "handle_request" in rdep_names

    def test_no_deps_for_leaf(self, populated_conn):
        conn, ids = populated_conn
        rebuild_symbol_edges(conn)
        conn.commit()
        deps = get_transitive_deps(conn, ids["s4"])
        assert isinstance(deps, list)

    def test_max_depth_limits_results(self, populated_conn):
        conn, ids = populated_conn
        rebuild_symbol_edges(conn)
        conn.commit()
        deps_deep = get_transitive_deps(conn, ids["s3"], max_depth=10)
        deps_shallow = get_transitive_deps(conn, ids["s3"], max_depth=0)
        assert len(deps_shallow) <= len(deps_deep)


class TestManualEdge:
    def test_add_edge(self, populated_conn):
        conn, ids = populated_conn
        add_edge(conn, ids["s1"], ids["s3"], "test_kind")
        conn.commit()
        edge = conn.execute(
            "SELECT * FROM symbol_edges WHERE source_symbol_id=? AND target_symbol_id=? AND kind=?",
            (ids["s1"], ids["s3"], "test_kind"),
        ).fetchone()
        assert edge is not None

    def test_duplicate_edge_ignored(self, populated_conn):
        conn, ids = populated_conn
        add_edge(conn, ids["s1"], ids["s3"], "test_kind")
        # Should not raise
        add_edge(conn, ids["s1"], ids["s3"], "test_kind")
        conn.commit()


class TestFTS:
    def test_search_by_name(self, populated_conn):
        conn, ids = populated_conn
        results = fts_search(conn, "authenticate")
        assert len(results) >= 1
        assert any(r["name"] == "authenticate" for r in results)

    def test_search_by_signature(self, populated_conn):
        conn, ids = populated_conn
        results = fts_search(conn, "req")
        assert len(results) >= 1

    def test_search_no_results(self, populated_conn):
        conn, ids = populated_conn
        results = fts_search(conn, "zzzznonexistent")
        assert len(results) == 0

    def test_search_with_limit(self, populated_conn):
        conn, ids = populated_conn
        results = fts_search(conn, "authenticate", limit=1)
        assert len(results) <= 1

    def test_results_have_rank(self, populated_conn):
        conn, ids = populated_conn
        results = fts_search(conn, "authenticate")
        assert len(results) >= 1
        assert "rank" in results[0]


class TestStats:
    def test_returns_all_fields(self, populated_conn):
        conn, _ = populated_conn
        s = get_stats(conn)
        assert "file_count" in s
        assert "symbol_count" in s
        assert "reference_count" in s
        assert "edge_count" in s
        assert "file_edge_count" in s

    def test_correct_counts(self, populated_conn):
        conn, _ = populated_conn
        s = get_stats(conn)
        assert s["file_count"] == 3
        assert s["symbol_count"] == 4
        assert s["reference_count"] == 3


class TestCascadeDeletes:
    def test_remove_file_cascades_symbols(self, populated_conn):
        conn, ids = populated_conn
        initial_stats = get_stats(conn)
        remove_file(conn, "src/auth.py")
        conn.commit()
        after_stats = get_stats(conn)
        assert after_stats["file_count"] == initial_stats["file_count"] - 1
        assert after_stats["symbol_count"] < initial_stats["symbol_count"]

    def test_remove_file_cascades_edges(self, populated_conn):
        conn, ids = populated_conn
        rebuild_file_edges(conn)
        rebuild_symbol_edges(conn)
        conn.commit()
        remove_file(conn, "src/auth.py")
        conn.commit()
        edges_to_auth = conn.execute(
            "SELECT COUNT(*) FROM symbol_edges WHERE source_symbol_id IN (?, ?) OR target_symbol_id IN (?, ?)",
            (ids["s1"], ids["s2"], ids["s1"], ids["s2"]),
        ).fetchone()[0]
        assert edges_to_auth == 0

    def test_remove_symbols_by_file(self, populated_conn):
        conn, ids = populated_conn
        remove_symbols_by_file(conn, "src/auth.py")
        conn.commit()
        assert get_symbol_by_id(conn, ids["s1"]) is None
        assert get_symbol_by_id(conn, ids["s2"]) is None
        # File itself should still exist
        assert get_file_by_path(conn, "src/auth.py") is not None


class TestHashContent:
    def test_deterministic(self):
        assert hash_content("hello") == hash_content("hello")

    def test_different_content(self):
        assert hash_content("hello") != hash_content("world")

    def test_returns_hex_string(self):
        h = hash_content("test")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)
