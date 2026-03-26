"""
Tree-sitter based parser for extracting definition and reference tags from source code.

Uses Aider-style @name.definition.* / @name.reference.* capture convention in
per-language .scm query files for structured tag extraction. Falls back to Pygments
lexer for reference extraction when tree-sitter queries lack reference patterns.
"""
import hashlib
import os
import sys
from collections import namedtuple
from pathlib import Path
from typing import Optional

import tree_sitter as ts
from tree_sitter_language_pack import get_language, get_parser

# Tag namedtuple: the single output type for all extraction
# kind is "def" or "ref"
# rel_fname is relative path, fname is absolute path
Tag = namedtuple("Tag", ["rel_fname", "fname", "line", "name", "kind"])

QUERIES_DIR = os.path.join(os.path.dirname(__file__), "queries")

# Map file extensions to tree-sitter language names
EXTENSION_MAP = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".rb": "ruby",
    ".java": "java",
    ".swift": "swift",
    ".kt": "kotlin",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "c_sharp",
    ".sh": "bash",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_language(file_path: str) -> Optional[str]:
    """Detect tree-sitter language from file extension."""
    ext = Path(file_path).suffix.lower()
    return EXTENSION_MAP.get(ext)


def compute_content_hash(content: str) -> str:
    """Compute a short SHA-256 hash of content for change detection."""
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def get_tags(fname: str, rel_fname: str = None) -> list[Tag]:
    """Extract definition and reference tags from a source file.

    Uses tree-sitter query files with @name.definition.* and @name.reference.*
    capture naming convention (Aider-style).

    Returns list of Tag namedtuples with kind="def" or kind="ref".
    """
    if rel_fname is None:
        rel_fname = fname

    lang = detect_language(fname)
    if not lang:
        return []

    source = _read_source(fname)
    if source is None:
        return []

    tree = _parse_source(source, lang, fname)
    if tree is None:
        return []

    scm_path = os.path.join(QUERIES_DIR, f"{lang}-tags.scm")
    if not os.path.exists(scm_path):
        # No query file -- use Pygments fallback for refs only
        return _pygments_ref_fallback(source, fname, rel_fname)

    tags = _extract_tags(tree, source, fname, rel_fname, lang, scm_path)

    # If we got defs but no refs, supplement with Pygments fallback for refs
    has_defs = any(t.kind == "def" for t in tags)
    has_refs = any(t.kind == "ref" for t in tags)
    if has_defs and not has_refs:
        ref_tags = _pygments_ref_fallback(source, fname, rel_fname)
        tags.extend(ref_tags)

    return tags


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _read_source(file_path: str) -> Optional[str]:
    """Read a source file, returning None on IO error."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except (IOError, OSError) as exc:
        print(f"Warning: Cannot read {file_path}: {exc}", file=sys.stderr)
        return None


def _parse_source(source: str, lang: str, file_path: str):
    """Parse source text with tree-sitter, returning None on error."""
    try:
        parser = get_parser(lang)
        return parser.parse(source.encode())
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: Parse error for {file_path}: {exc}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Tag extraction via tree-sitter queries
# ---------------------------------------------------------------------------

def _extract_tags(tree, source: str, fname: str, rel_fname: str, lang: str, scm_path: str) -> list[Tag]:
    """Extract tags using tree-sitter query with @name.definition.* / @name.reference.* convention."""
    try:
        with open(scm_path) as fh:
            query_text = fh.read()
    except (IOError, OSError):
        return []

    try:
        language = get_language(lang)
        query = ts.Query(language, query_text)
        cursor = ts.QueryCursor(query)
        matches = list(cursor.matches(tree.root_node))
    except Exception:  # noqa: BLE001
        return []

    tags = []
    seen = {}  # (name, start_byte, end_byte) -> Tag for dedup

    for _pattern_idx, capture_dict in matches:
        for capture_name, nodes in capture_dict.items():
            # Only process @name.definition.* and @name.reference.* captures
            if capture_name.startswith("name.definition."):
                kind = "def"
            elif capture_name.startswith("name.reference."):
                kind = "ref"
            else:
                continue

            for node in nodes:
                name_text = source[node.start_byte:node.end_byte].strip()
                if not name_text:
                    continue

                key = (name_text, node.start_byte, node.end_byte)
                if key in seen:
                    continue

                line = node.start_point[0] + 1
                tag = Tag(rel_fname=rel_fname, fname=fname, line=line, name=name_text, kind=kind)
                seen[key] = tag
                tags.append(tag)

    return tags


# ---------------------------------------------------------------------------
# Pygments fallback for references
# ---------------------------------------------------------------------------

def _pygments_ref_fallback(source: str, fname: str, rel_fname: str) -> list[Tag]:
    """Use Pygments to extract reference-like tokens when tree-sitter refs are missing."""
    try:
        from pygments.lexers import get_lexer_for_filename
        from pygments.token import Token
    except ImportError:
        return []

    try:
        lexer = get_lexer_for_filename(fname)
    except Exception:  # noqa: BLE001
        return []

    tags = []
    line = 1
    for token_type, value in lexer.get_tokens(source):
        # Count newlines for line tracking
        newlines = value.count('\n')
        if token_type in Token.Name and value.strip():
            tags.append(Tag(rel_fname=rel_fname, fname=fname, line=line, name=value.strip(), kind="ref"))
        line += newlines

    return tags


# ---------------------------------------------------------------------------
# Small utilities (kept for potential downstream use)
# ---------------------------------------------------------------------------

def _first_line(text: str, max_len: int = 200) -> str:
    """Return the first non-empty line of text, truncated to max_len."""
    line = text.split("\n")[0].strip()
    return line[:max_len] + "..." if len(line) > max_len else line


def _find_doc_comment(node, source: str) -> str:
    """Try to extract a doc comment from the node's previous sibling."""
    prev = node.prev_named_sibling
    if prev and prev.type in ("comment", "block_comment", "string", "string_literal"):
        text = source[prev.start_byte:prev.end_byte].strip()
        # Strip common comment markers
        for marker in ("///", "/**", "/*", "*/", "//", "#", '"""', "'''"):
            text = text.strip(marker)
        return text.strip()[:500]
    return ""
