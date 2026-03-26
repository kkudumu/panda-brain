"""Tests for parser.py -- Aider-style def/ref tag extraction."""
import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(__file__))
from parser import get_tags, detect_language, Tag, EXTENSION_MAP

FIXTURES = os.path.join(os.path.dirname(__file__), "tests", "fixtures", "sample_project")


class TestDetectLanguage:
    def test_python(self):
        assert detect_language("foo.py") == "python"

    def test_typescript(self):
        assert detect_language("foo.ts") == "typescript"

    def test_javascript(self):
        assert detect_language("foo.js") == "javascript"

    def test_tsx(self):
        assert detect_language("foo.tsx") == "tsx"

    def test_unknown(self):
        assert detect_language("foo.txt") is None

    def test_all_extensions_mapped(self):
        for ext, lang in EXTENSION_MAP.items():
            assert lang is not None, f"Extension {ext} mapped to None"


class TestPythonTags:
    def test_extracts_defs_and_refs(self):
        fpath = os.path.join(FIXTURES, "auth.py")
        tags = get_tags(fpath, "auth.py")
        defs = [t for t in tags if t.kind == "def"]
        refs = [t for t in tags if t.kind == "ref"]
        assert len(defs) >= 3, f"Expected >=3 defs, got {len(defs)}: {[t.name for t in defs]}"
        assert len(refs) >= 2, f"Expected >=2 refs, got {len(refs)}: {[t.name for t in refs]}"

    def test_def_names_correct(self):
        fpath = os.path.join(FIXTURES, "auth.py")
        tags = get_tags(fpath, "auth.py")
        def_names = {t.name for t in tags if t.kind == "def"}
        assert "handleAuth" in def_names
        assert "validateToken" in def_names
        assert "getUser" in def_names

    def test_ref_names_correct(self):
        fpath = os.path.join(FIXTURES, "auth.py")
        tags = get_tags(fpath, "auth.py")
        ref_names = {t.name for t in tags if t.kind == "ref"}
        assert "validateToken" in ref_names
        assert "getUser" in ref_names

    def test_no_garbled_names(self):
        fpath = os.path.join(FIXTURES, "auth.py")
        tags = get_tags(fpath, "auth.py")
        for tag in tags:
            assert tag.name.isidentifier(), f"Garbled name: {tag.name}"

    def test_tag_has_correct_fields(self):
        fpath = os.path.join(FIXTURES, "auth.py")
        tags = get_tags(fpath, "auth.py")
        assert len(tags) > 0
        tag = tags[0]
        assert hasattr(tag, "rel_fname")
        assert hasattr(tag, "fname")
        assert hasattr(tag, "line")
        assert hasattr(tag, "name")
        assert hasattr(tag, "kind")
        assert tag.kind in ("def", "ref")

    def test_rel_fname_propagated(self):
        fpath = os.path.join(FIXTURES, "auth.py")
        tags = get_tags(fpath, "auth.py")
        for tag in tags:
            assert tag.rel_fname == "auth.py"

    def test_no_duplicates(self):
        fpath = os.path.join(FIXTURES, "auth.py")
        tags = get_tags(fpath, "auth.py")
        seen = set()
        for tag in tags:
            key = (tag.name, tag.line, tag.kind)
            assert key not in seen, f"Duplicate tag: {tag}"
            seen.add(key)


class TestTypeScriptTags:
    def test_extracts_defs_and_refs(self):
        fpath = os.path.join(FIXTURES, "api.ts")
        tags = get_tags(fpath, "api.ts")
        defs = [t for t in tags if t.kind == "def"]
        refs = [t for t in tags if t.kind == "ref"]
        assert len(defs) >= 3, f"Expected >=3 defs, got {len(defs)}: {[t.name for t in defs]}"
        assert len(refs) >= 2, f"Expected >=2 refs, got {len(refs)}: {[t.name for t in refs]}"

    def test_captures_class(self):
        fpath = os.path.join(FIXTURES, "api.ts")
        tags = get_tags(fpath, "api.ts")
        def_names = {t.name for t in tags if t.kind == "def"}
        assert "ApiController" in def_names

    def test_captures_function_defs(self):
        fpath = os.path.join(FIXTURES, "api.ts")
        tags = get_tags(fpath, "api.ts")
        def_names = {t.name for t in tags if t.kind == "def"}
        assert "processRequest" in def_names
        assert "formatResponse" in def_names

    def test_captures_call_refs(self):
        fpath = os.path.join(FIXTURES, "api.ts")
        tags = get_tags(fpath, "api.ts")
        ref_names = {t.name for t in tags if t.kind == "ref"}
        assert "handleAuth" in ref_names or "formatResponse" in ref_names

    def test_captures_cross_file_ref(self):
        """api.ts imports and calls handleAuth from auth.py -- should appear as ref."""
        fpath = os.path.join(FIXTURES, "api.ts")
        tags = get_tags(fpath, "api.ts")
        ref_names = {t.name for t in tags if t.kind == "ref"}
        assert "handleAuth" in ref_names


class TestJavaScriptTags:
    def test_extracts_defs_and_refs(self):
        fpath = os.path.join(FIXTURES, "utils.js")
        tags = get_tags(fpath, "utils.js")
        defs = [t for t in tags if t.kind == "def"]
        refs = [t for t in tags if t.kind == "ref"]
        assert len(defs) >= 3, f"Expected >=3 defs, got {len(defs)}: {[t.name for t in defs]}"
        assert len(refs) >= 2, f"Expected >=2 refs, got {len(refs)}: {[t.name for t in refs]}"

    def test_arrow_function_defs(self):
        fpath = os.path.join(FIXTURES, "utils.js")
        tags = get_tags(fpath, "utils.js")
        def_names = {t.name for t in tags if t.kind == "def"}
        assert "processData" in def_names

    def test_regular_function_defs(self):
        fpath = os.path.join(FIXTURES, "utils.js")
        tags = get_tags(fpath, "utils.js")
        def_names = {t.name for t in tags if t.kind == "def"}
        assert "formatDate" in def_names
        assert "parseConfig" in def_names

    def test_cross_function_refs(self):
        fpath = os.path.join(FIXTURES, "utils.js")
        tags = get_tags(fpath, "utils.js")
        ref_names = {t.name for t in tags if t.kind == "ref"}
        assert "parseConfig" in ref_names
        assert "formatDate" in ref_names


class TestNonexistentFile:
    def test_returns_empty(self):
        tags = get_tags("/nonexistent/file.py", "file.py")
        assert tags == []

    def test_unknown_extension(self):
        tags = get_tags("file.xyz", "file.xyz")
        assert tags == []


class TestTagNamedTuple:
    def test_tag_is_namedtuple(self):
        tag = Tag(rel_fname="a.py", fname="/a.py", line=1, name="foo", kind="def")
        assert tag.rel_fname == "a.py"
        assert tag.fname == "/a.py"
        assert tag.line == 1
        assert tag.name == "foo"
        assert tag.kind == "def"
