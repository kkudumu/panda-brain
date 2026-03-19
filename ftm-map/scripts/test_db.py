"""Tests for ftm-map database module."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from db import (
    get_connection, add_symbol, remove_symbols_by_file, add_edge,
    get_symbol_by_id, get_symbol_by_name, get_transitive_deps,
    get_reverse_deps, fts_search, get_stats
)

class TestDatabase(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.conn = get_connection(self.tmpdir)

    def tearDown(self):
        self.conn.close()

    def test_schema_creation(self):
        """Tables and indexes should exist after connection."""
        tables = [r[0] for r in self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        self.assertIn("symbols", tables)
        self.assertIn("edges", tables)
        self.assertIn("symbols_fts", tables)

    def test_wal_mode(self):
        """WAL mode should be enabled."""
        mode = self.conn.execute("PRAGMA journal_mode").fetchone()[0]
        self.assertEqual(mode, "wal")

    def test_add_and_get_symbol(self):
        """Should insert and retrieve a symbol."""
        sid = add_symbol(self.conn, "handleAuth", "function", "auth.py", 1, 5, "def handleAuth(request)", "Auth handler", "abc123")
        self.conn.commit()
        sym = get_symbol_by_id(self.conn, sid)
        self.assertIsNotNone(sym)
        self.assertEqual(sym["name"], "handleAuth")
        self.assertEqual(sym["kind"], "function")

    def test_remove_symbols_by_file(self):
        """Should remove all symbols for a file."""
        add_symbol(self.conn, "foo", "function", "test.py", 1, 3)
        add_symbol(self.conn, "bar", "function", "test.py", 5, 8)
        add_symbol(self.conn, "baz", "function", "other.py", 1, 3)
        self.conn.commit()
        remove_symbols_by_file(self.conn, "test.py")
        self.conn.commit()
        self.assertEqual(len(get_symbol_by_name(self.conn, "foo")), 0)
        self.assertEqual(len(get_symbol_by_name(self.conn, "baz")), 1)

    def test_edges_and_cascade(self):
        """Edges should be deleted when source symbol is removed."""
        s1 = add_symbol(self.conn, "caller", "function", "a.py", 1, 5)
        s2 = add_symbol(self.conn, "callee", "function", "b.py", 1, 5)
        add_edge(self.conn, s1, s2, "calls")
        self.conn.commit()
        remove_symbols_by_file(self.conn, "a.py")
        self.conn.commit()
        edges = self.conn.execute("SELECT * FROM edges").fetchall()
        self.assertEqual(len(edges), 0)

    def test_transitive_deps(self):
        """Should return transitive dependency chain."""
        # A calls B, B calls C
        a = add_symbol(self.conn, "A", "function", "a.py", 1, 5)
        b = add_symbol(self.conn, "B", "function", "b.py", 1, 5)
        c = add_symbol(self.conn, "C", "function", "c.py", 1, 5)
        add_edge(self.conn, a, b, "calls")
        add_edge(self.conn, b, c, "calls")
        self.conn.commit()
        deps = get_transitive_deps(self.conn, a)
        dep_names = {d["name"] for d in deps}
        self.assertIn("B", dep_names)
        self.assertIn("C", dep_names)

    def test_reverse_deps_blast_radius(self):
        """Blast radius of C should return B and A."""
        a = add_symbol(self.conn, "A", "function", "a.py", 1, 5)
        b = add_symbol(self.conn, "B", "function", "b.py", 1, 5)
        c = add_symbol(self.conn, "C", "function", "c.py", 1, 5)
        add_edge(self.conn, a, b, "calls")
        add_edge(self.conn, b, c, "calls")
        self.conn.commit()
        blast = get_reverse_deps(self.conn, c)
        blast_names = {d["name"] for d in blast}
        self.assertIn("B", blast_names)
        self.assertIn("A", blast_names)

    def test_fts_search(self):
        """FTS5 search should rank handleAuth above getUser for 'handle' query."""
        add_symbol(self.conn, "handleAuth", "function", "auth.py", 1, 5, "def handleAuth(request)", "Handle authentication")
        add_symbol(self.conn, "getUser", "function", "auth.py", 7, 10, "def getUser(user_id)", "Get user by ID")
        self.conn.commit()
        results = fts_search(self.conn, "handle")
        self.assertGreater(len(results), 0)
        self.assertEqual(results[0]["name"], "handleAuth")

    def test_cycle_prevention(self):
        """Recursive CTE should not loop on cycles."""
        a = add_symbol(self.conn, "A", "function", "a.py", 1, 5)
        b = add_symbol(self.conn, "B", "function", "b.py", 1, 5)
        add_edge(self.conn, a, b, "calls")
        add_edge(self.conn, b, a, "calls")  # cycle!
        self.conn.commit()
        deps = get_transitive_deps(self.conn, a)
        # Should not hang, and should contain B
        self.assertTrue(any(d["name"] == "B" for d in deps))

    def test_stats(self):
        """Stats should return correct counts."""
        add_symbol(self.conn, "x", "function", "x.py", 1, 3)
        add_symbol(self.conn, "y", "function", "y.py", 1, 3)
        self.conn.commit()
        stats = get_stats(self.conn)
        self.assertEqual(stats["symbols"], 2)
        self.assertEqual(stats["files"], 2)

if __name__ == "__main__":
    unittest.main()
