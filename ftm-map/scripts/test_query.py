"""Tests for ftm-map query module."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from db import get_connection, add_symbol, add_edge
from query import blast_radius, dependency_chain, search, symbol_info

class TestQuery(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.conn = get_connection(self.tmpdir)
        # Build test graph: A -> B -> C, D imports A
        self.a = add_symbol(self.conn, "handleAuth", "function", "auth.py", 1, 5, "def handleAuth(req)", "Auth handler")
        self.b = add_symbol(self.conn, "validateToken", "function", "auth.py", 7, 10, "def validateToken(token)")
        self.c = add_symbol(self.conn, "getUser", "function", "users.py", 1, 5, "def getUser(uid)")
        self.d = add_symbol(self.conn, "processRequest", "function", "api.ts", 1, 8, "function processRequest(req)")
        add_edge(self.conn, self.a, self.b, "calls")
        add_edge(self.conn, self.a, self.c, "calls")
        add_edge(self.conn, self.d, self.a, "calls")
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_blast_radius(self):
        """Blast radius of getUser should include handleAuth and processRequest."""
        result = blast_radius(self.conn, "getUser")
        names = {r["name"] for r in result["results"]}
        self.assertIn("handleAuth", names)
        self.assertIn("processRequest", names)
        self.assertEqual(result["affected_count"], 2)

    def test_dependency_chain(self):
        """handleAuth depends on validateToken and getUser."""
        result = dependency_chain(self.conn, "handleAuth")
        names = {r["name"] for r in result["results"]}
        self.assertIn("validateToken", names)
        self.assertIn("getUser", names)

    def test_search(self):
        """Search for 'auth' should return handleAuth."""
        result = search(self.conn, "auth")
        self.assertGreater(result["result_count"], 0)
        names = {r["name"] for r in result["results"]}
        self.assertIn("handleAuth", names)

    def test_symbol_info(self):
        """Should return full details with callers and callees."""
        result = symbol_info(self.conn, "handleAuth")
        self.assertEqual(result["name"], "handleAuth")
        callee_names = {c["name"] for c in result["callees"]}
        self.assertIn("validateToken", callee_names)
        self.assertIn("getUser", callee_names)
        caller_names = {c["name"] for c in result["callers"]}
        self.assertIn("processRequest", caller_names)

    def test_missing_symbol(self):
        """Query for non-existent symbol should return error."""
        result = blast_radius(self.conn, "nonexistent")
        self.assertIn("error", result)

if __name__ == "__main__":
    unittest.main()
