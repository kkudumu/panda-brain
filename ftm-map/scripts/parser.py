"""
Tree-sitter based parser for extracting symbols and relationships from source code.
Uses tree-sitter-language-pack for multi-language support and per-language .scm query files.
"""
import hashlib
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import tree_sitter as ts
from tree_sitter_language_pack import get_language, get_parser

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

# Node types that represent definitions in generic AST walk, keyed by node type
DEFINITION_TYPES = {
    # TypeScript / JavaScript
    "function_declaration": "function",
    "method_definition": "method",
    "class_declaration": "class",
    "arrow_function": "function",
    "lexical_declaration": "variable",
    "variable_declaration": "variable",
    "interface_declaration": "class",
    "type_alias_declaration": "type",
    "enum_declaration": "class",
    # Python
    "function_definition": "function",
    "class_definition": "class",
    "decorated_definition": None,  # unwrap to inner definition
    # Imports
    "import_statement": "import",
    "import_from_statement": "import",
}

# Node types that carry a symbol name field
NAME_TYPES = frozenset({
    "identifier",
    "property_identifier",
    "type_identifier",
})

# Node types representing call expressions per language
CALL_TYPES = frozenset({
    "call_expression",  # JS/TS/Go/Rust
    "call",             # Ruby
})

# Node types representing import statements
IMPORT_TYPES = frozenset({
    "import_statement",
    "import_from_statement",
})


@dataclass
class Symbol:
    name: str
    kind: str           # function, class, method, variable, import, type
    file_path: str
    start_line: int
    end_line: int
    signature: str = ""
    doc_comment: str = ""
    content_hash: str = ""


@dataclass
class Relationship:
    source_name: str
    target_name: str
    kind: str           # calls, imports, extends, implements, uses
    source_file: str
    target_file: str = ""  # may be unknown for cross-file refs


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


def parse_file(file_path: str) -> list[Symbol]:
    """Parse a source file and extract symbols.

    Returns a list of Symbol objects. Handles parse errors gracefully by
    returning partial results and logging warnings to stderr.
    """
    lang = detect_language(file_path)
    if not lang:
        return []

    source = _read_source(file_path)
    if source is None:
        return []

    tree = _parse_source(source, lang, file_path)
    if tree is None:
        return []

    scm_path = os.path.join(QUERIES_DIR, f"{lang}-tags.scm")
    if os.path.exists(scm_path):
        symbols = _extract_with_query(tree, source, file_path, lang, scm_path)
        # Fall back to generic walk if the query produced nothing
        if symbols:
            return symbols

    return _extract_generic(tree, source, file_path)


def extract_relationships(file_path: str) -> list[Relationship]:
    """Extract relationships (calls, imports) from a source file.

    Returns a list of Relationship objects.
    """
    lang = detect_language(file_path)
    if not lang:
        return []

    source = _read_source(file_path)
    if source is None:
        return []

    tree = _parse_source(source, lang, file_path)
    if tree is None:
        return []

    relationships: list[Relationship] = []
    _extract_calls(tree.root_node, source, file_path, relationships)
    _extract_imports(tree.root_node, source, file_path, relationships)
    return relationships


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
# Query-based extraction
# ---------------------------------------------------------------------------

def _extract_with_query(tree, source: str, file_path: str, lang: str, scm_path: str) -> list[Symbol]:
    """Extract symbols using a language-specific .scm query file.

    Uses tree-sitter QueryCursor.matches() which returns per-pattern match dicts.
    Each match dict contains both the @definition.X node and the @name node so
    they are already correlated — no post-hoc joining needed.

    Falls back to empty list on any error so callers can use generic extraction.
    """
    try:
        with open(scm_path) as fh:
            query_text = fh.read()
    except (IOError, OSError) as exc:
        print(f"Warning: Cannot read query {scm_path}: {exc}", file=sys.stderr)
        return []

    try:
        language = get_language(lang)
        query = ts.Query(language, query_text)
        cursor = ts.QueryCursor(query)
        matches = list(cursor.matches(tree.root_node))
    except Exception as exc:  # noqa: BLE001
        print(f"Warning: Query execution failed for {file_path}: {exc}", file=sys.stderr)
        return []

    return _process_matches(matches, source, file_path)


def _process_matches(matches: list, source: str, file_path: str) -> list[Symbol]:
    """Convert QueryCursor.matches() results into Symbol objects.

    Each match is a (pattern_index, capture_dict) tuple where capture_dict maps
    capture name → list[Node].  Both @definition.X and @name appear in the same
    capture_dict for each pattern match, making correlation trivial.
    """
    symbols: list[Symbol] = []

    for _pattern_idx, capture_dict in matches:
        # Find the definition capture (e.g. "definition.function")
        def_key = next(
            (k for k in capture_dict if k.startswith("definition.")),
            None,
        )
        if not def_key:
            continue

        kind = def_key[len("definition."):]
        def_nodes = capture_dict[def_key]
        name_nodes = capture_dict.get("name", [])

        if not def_nodes:
            continue

        def_node = def_nodes[0]

        # Prefer the @name capture; fall back to identifier child walk
        if name_nodes:
            sym_name = source[name_nodes[0].start_byte:name_nodes[0].end_byte].strip()
        else:
            sym_name = _find_name(def_node, source)

        if not sym_name:
            continue

        body = source[def_node.start_byte:def_node.end_byte]
        sig = _first_line(body)
        doc = _find_doc_comment(def_node, source)

        symbols.append(Symbol(
            name=sym_name,
            kind=kind,
            file_path=file_path,
            start_line=def_node.start_point[0] + 1,
            end_line=def_node.end_point[0] + 1,
            signature=sig,
            doc_comment=doc,
            content_hash=compute_content_hash(body),
        ))

    return symbols


# ---------------------------------------------------------------------------
# Generic AST walk extraction
# ---------------------------------------------------------------------------

def _extract_generic(tree, source: str, file_path: str) -> list[Symbol]:
    """Walk the AST and extract symbols without a query file."""
    symbols: list[Symbol] = []
    _walk_node(tree.root_node, source, file_path, symbols)
    return symbols


def _walk_node(node, source: str, file_path: str, symbols: list[Symbol]) -> None:
    """Recursively walk AST nodes looking for definition nodes."""
    node_type = node.type

    if node_type in DEFINITION_TYPES:
        kind = DEFINITION_TYPES[node_type]

        if kind is None:
            # Decorated definition — unwrap inner nodes only
            for child in node.children:
                _walk_node(child, source, file_path, symbols)
            return

        # Skip bare arrow functions without a variable name context
        if node_type == "arrow_function":
            for child in node.children:
                _walk_node(child, source, file_path, symbols)
            return

        name = _find_name(node, source)
        if not name:
            for child in node.children:
                _walk_node(child, source, file_path, symbols)
            return

        body = source[node.start_byte:node.end_byte]
        sig = _first_line(body)
        doc = _find_doc_comment(node, source)

        symbols.append(Symbol(
            name=name,
            kind=kind,
            file_path=file_path,
            start_line=node.start_point[0] + 1,
            end_line=node.end_point[0] + 1,
            signature=sig,
            doc_comment=doc,
            content_hash=compute_content_hash(body),
        ))

    # Always recurse (definitions can be nested)
    for child in node.children:
        _walk_node(child, source, file_path, symbols)


# ---------------------------------------------------------------------------
# Relationship extraction
# ---------------------------------------------------------------------------

def _extract_calls(node, source: str, file_path: str, rels: list[Relationship]) -> None:
    """Recursively extract function call relationships."""
    if node.type in CALL_TYPES:
        func_node = node.children[0] if node.children else None
        if func_node:
            callee_text = source[func_node.start_byte:func_node.end_byte]
            # Simplify dotted paths to last component
            callee_name = callee_text.split(".")[-1].split("(")[0].strip()
            caller_name = _find_enclosing_function(node, source)
            if callee_name and caller_name:
                rels.append(Relationship(
                    source_name=caller_name,
                    target_name=callee_name,
                    kind="calls",
                    source_file=file_path,
                ))

    for child in node.children:
        _extract_calls(child, source, file_path, rels)


def _extract_imports(node, source: str, file_path: str, rels: list[Relationship]) -> None:
    """Recursively extract import relationships."""
    if node.type in IMPORT_TYPES:
        module_stem = Path(file_path).stem
        _collect_import_names(node, source, module_stem, file_path, rels)

    for child in node.children:
        _extract_imports(child, source, file_path, rels)


def _collect_import_names(
    node,
    source: str,
    module_stem: str,
    file_path: str,
    rels: list[Relationship],
) -> None:
    """Walk an import node and emit Relationship objects for each imported name."""
    for child in node.children:
        child_type = child.type

        if child_type == "dotted_name":
            imported = source[child.start_byte:child.end_byte]
            rels.append(Relationship(
                source_name=module_stem,
                target_name=imported,
                kind="imports",
                source_file=file_path,
            ))

        elif child_type in ("import_clause", "named_imports", "import_specifier"):
            for grandchild in child.children:
                if grandchild.type in NAME_TYPES:
                    name = source[grandchild.start_byte:grandchild.end_byte].strip()
                    if name and name not in ("{", "}", ","):
                        rels.append(Relationship(
                            source_name=module_stem,
                            target_name=name,
                            kind="imports",
                            source_file=file_path,
                        ))

        elif child_type == "string":
            # import ... from "module-path"
            raw = source[child.start_byte:child.end_byte].strip("'\"")
            rels.append(Relationship(
                source_name=module_stem,
                target_name=raw,
                kind="imports",
                source_file=file_path,
            ))


# ---------------------------------------------------------------------------
# Small AST utilities
# ---------------------------------------------------------------------------

def _find_name(node, source: str) -> str:
    """Find the first name-like identifier child of a node."""
    for child in node.children:
        if child.type in NAME_TYPES:
            return source[child.start_byte:child.end_byte]
    return ""


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


def _first_line(text: str, max_len: int = 200) -> str:
    """Return the first non-empty line of text, truncated to max_len."""
    line = text.split("\n")[0].strip()
    return line[:max_len] + "..." if len(line) > max_len else line


def _find_enclosing_function(node, source: str) -> str:
    """Walk up the AST to find the name of the nearest enclosing function."""
    enclosing_types = {
        "function_declaration",
        "function_definition",
        "method_definition",
        "arrow_function",
    }
    current = node.parent
    while current:
        if current.type in enclosing_types:
            name = _find_name(current, source)
            if name:
                return name
        current = current.parent
    return ""
