"""Tests for ftm-map parser module."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "tests", "fixtures", "sample_project")

class TestParser(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        """Check if tree-sitter-language-pack is available."""
        try:
            from parser import parse_file, extract_relationships, detect_language
            cls.parse_file = staticmethod(parse_file)
            cls.extract_relationships = staticmethod(extract_relationships)
            cls.detect_language = staticmethod(detect_language)
            cls.skip_reason = None
        except ImportError as e:
            cls.skip_reason = f"tree-sitter-language-pack not installed: {e}"

    def setUp(self):
        if self.skip_reason:
            self.skipTest(self.skip_reason)

    def test_detect_language(self):
        self.assertEqual(self.detect_language("foo.py"), "python")
        self.assertEqual(self.detect_language("bar.ts"), "typescript")
        self.assertEqual(self.detect_language("baz.js"), "javascript")
        self.assertIsNone(self.detect_language("README.md"))

    def test_parse_python_file(self):
        """Should extract Python functions."""
        path = os.path.join(FIXTURES_DIR, "auth.py")
        if not os.path.exists(path):
            self.skipTest("Fixture not found")
        symbols = self.parse_file(path)
        names = {s.name for s in symbols}
        self.assertIn("handleAuth", names)
        self.assertIn("validateToken", names)
        self.assertIn("getUser", names)

    def test_parse_typescript_file(self):
        """Should extract TypeScript functions and classes."""
        path = os.path.join(FIXTURES_DIR, "api.ts")
        if not os.path.exists(path):
            self.skipTest("Fixture not found")
        symbols = self.parse_file(path)
        names = {s.name for s in symbols}
        self.assertIn("processRequest", names)
        self.assertIn("ApiController", names)

    def test_parse_javascript_file(self):
        """Should extract JavaScript functions."""
        path = os.path.join(FIXTURES_DIR, "utils.js")
        if not os.path.exists(path):
            self.skipTest("Fixture not found")
        symbols = self.parse_file(path)
        names = {s.name for s in symbols}
        self.assertIn("formatDate", names)
        self.assertIn("parseConfig", names)

    def test_symbol_has_content_hash(self):
        """Every symbol should have a content hash."""
        path = os.path.join(FIXTURES_DIR, "auth.py")
        if not os.path.exists(path):
            self.skipTest("Fixture not found")
        symbols = self.parse_file(path)
        for sym in symbols:
            self.assertTrue(len(sym.content_hash) > 0, f"{sym.name} missing content_hash")

    def test_symbol_has_line_numbers(self):
        """Every symbol should have start and end line."""
        path = os.path.join(FIXTURES_DIR, "auth.py")
        if not os.path.exists(path):
            self.skipTest("Fixture not found")
        symbols = self.parse_file(path)
        for sym in symbols:
            self.assertGreater(sym.start_line, 0)
            self.assertGreaterEqual(sym.end_line, sym.start_line)

    def test_extract_relationships(self):
        """Should extract call relationships."""
        path = os.path.join(FIXTURES_DIR, "auth.py")
        if not os.path.exists(path):
            self.skipTest("Fixture not found")
        rels = self.extract_relationships(path)
        # handleAuth calls validateToken and getUser
        call_targets = {r.target_name for r in rels if r.kind == "calls"}
        self.assertIn("validateToken", call_targets)
        self.assertIn("getUser", call_targets)

    def test_unsupported_file_returns_empty(self):
        """Unsupported file types should return empty list."""
        symbols = self.parse_file("/tmp/fake.xyz")
        self.assertEqual(symbols, [])

    def test_nonexistent_file_returns_empty(self):
        """Non-existent files should return empty list, not error."""
        symbols = self.parse_file("/tmp/nonexistent_file_12345.py")
        self.assertEqual(symbols, [])

if __name__ == "__main__":
    unittest.main()
