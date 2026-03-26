#!/usr/bin/env python3
"""View generators: produce INTENT.md and ARCHITECTURE.mmd from the code graph.

Updated for v2 hybrid architecture with 5-table schema:
  files, symbols, refs, file_edges, symbol_edges
"""

import argparse
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from db import get_connection

# ---------------------------------------------------------------------------
# Module grouping helpers
# ---------------------------------------------------------------------------


def _get_module_for_path(file_path: str) -> str:
    """Return the top-level directory component of a relative file path.

    Files at the project root (no directory component) are grouped under '.'.
    """
    parts = Path(file_path).parts
    if len(parts) > 1:
        return parts[0]
    return "."


def get_modules(conn) -> dict:
    """Group files by directory to identify modules.

    Queries the files table directly (symbols no longer carry file_path).
    Returns a dict mapping module name -> set of file paths.
    """
    rows = conn.execute(
        "SELECT DISTINCT path FROM files ORDER BY path"
    ).fetchall()

    modules: dict = defaultdict(set)
    for row in rows:
        fp = row["path"]
        module = _get_module_for_path(fp)
        modules[module].add(fp)

    return dict(modules)


def _get_symbols_for_module(conn, module: str, files: set) -> list:
    """Return all symbol rows for a module (identified by its set of files).

    Joins symbols with files to resolve file_path and maps column names
    to the view-layer conventions (file_path, start_line, end_line).
    """
    placeholders = ",".join("?" * len(files))
    rows = conn.execute(
        f"""
        SELECT s.id, s.name, s.qualified_name, s.kind,
               s.line_start AS start_line, s.line_end AS end_line,
               s.signature, s.parent_id,
               f.path AS file_path
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE f.path IN ({placeholders})
        ORDER BY f.path, s.line_start
        """,
        list(files),
    ).fetchall()
    return [dict(r) for r in rows]


def _get_callers(conn, symbol_id: int) -> list:
    """Return direct callers (symbols that call this one) via symbol_edges."""
    rows = conn.execute(
        """
        SELECT s.name, f.path AS file_path
        FROM symbol_edges se
        JOIN symbols s ON s.id = se.source_symbol_id
        JOIN files f ON f.id = s.file_id
        WHERE se.target_symbol_id = ?
        LIMIT 10
        """,
        (symbol_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _get_callees(conn, symbol_id: int) -> list:
    """Return direct callees (symbols this one calls) via symbol_edges."""
    rows = conn.execute(
        """
        SELECT s.name, f.path AS file_path
        FROM symbol_edges se
        JOIN symbols s ON s.id = se.target_symbol_id
        JOIN files f ON f.id = s.file_id
        WHERE se.source_symbol_id = ?
        LIMIT 10
        """,
        (symbol_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _get_ref_count(conn, symbol_name: str) -> int:
    """Return the number of references to a symbol from the refs table."""
    row = conn.execute(
        "SELECT COUNT(*) AS cnt FROM refs WHERE symbol_name = ?",
        (symbol_name,),
    ).fetchone()
    return row["cnt"] if row else 0


def _top_symbols(symbols: list, n: int = 5) -> list:
    """Return top n function/method symbols from a list, falling back to any kind."""
    funcs = [s for s in symbols if s["kind"] in ("function", "method", "definition")]
    selection = funcs if funcs else symbols
    return selection[:n]


def _infer_purpose(module: str, symbols: list) -> str:
    """Infer a one-line purpose description from module name and symbol kinds."""
    if not symbols:
        return "Empty module — no symbols indexed yet."

    kinds = [s["kind"] for s in symbols]
    kind_counts: dict = defaultdict(int)
    for k in kinds:
        kind_counts[k] += 1

    dominant = sorted(kind_counts.items(), key=lambda x: x[1], reverse=True)[0][0]

    name_lower = module.lower()
    if any(kw in name_lower for kw in ("test", "spec", "__tests__")):
        return "Test suite."
    if any(kw in name_lower for kw in ("util", "helper", "common", "shared")):
        return "Shared utilities and helpers."
    if any(kw in name_lower for kw in ("model", "schema", "entity", "type")):
        return "Data models and type definitions."
    if any(kw in name_lower for kw in ("route", "api", "handler", "endpoint")):
        return "API routes and request handlers."
    if any(kw in name_lower for kw in ("db", "database", "repo", "store")):
        return "Data access and persistence layer."
    if any(kw in name_lower for kw in ("config", "setting", "env")):
        return "Configuration and environment settings."
    if any(kw in name_lower for kw in ("service", "manager", "controller")):
        return "Business logic and service layer."
    if any(kw in name_lower for kw in ("component", "view", "page", "ui")):
        return "UI components and views."

    if dominant == "class":
        return f"Module defining {kind_counts['class']} class(es)."
    if dominant == "function":
        return f"Module with {kind_counts['function']} function(s)."
    if dominant == "definition":
        return f"Module with {kind_counts['definition']} definition(s)."
    return f"Module containing {len(symbols)} symbols."


def _infer_function_does(sym: dict) -> str:
    """Infer what a function does from its name and signature."""
    doc = (sym.get("doc_comment") or "").strip()
    if doc:
        first_sentence = doc.split(".")[0].strip()
        if first_sentence:
            return first_sentence + "."

    sig = (sym.get("signature") or "").strip()
    name = sym.get("name", "")

    name_lower = name.lower()
    if name_lower.startswith("get_") or name_lower.startswith("fetch_"):
        subject = name_lower[4:].replace("_", " ")
        return f"Retrieves {subject}."
    if name_lower.startswith("set_") or name_lower.startswith("update_"):
        subject = name_lower[4:].replace("_", " ")
        return f"Updates {subject}."
    if name_lower.startswith("create_") or name_lower.startswith("add_"):
        subject = name_lower.split("_", 1)[1].replace("_", " ") if "_" in name_lower else name_lower
        return f"Creates or adds {subject}."
    if name_lower.startswith("delete_") or name_lower.startswith("remove_"):
        subject = name_lower.split("_", 1)[1].replace("_", " ") if "_" in name_lower else name_lower
        return f"Removes {subject}."
    if name_lower.startswith("is_") or name_lower.startswith("has_") or name_lower.startswith("check_"):
        subject = name_lower.split("_", 1)[1].replace("_", " ") if "_" in name_lower else name_lower
        return f"Checks whether {subject}."
    if name_lower.startswith("parse_") or name_lower.startswith("decode_"):
        subject = name_lower.split("_", 1)[1].replace("_", " ") if "_" in name_lower else name_lower
        return f"Parses {subject}."
    if name_lower.startswith("render_") or name_lower.startswith("format_"):
        subject = name_lower.split("_", 1)[1].replace("_", " ") if "_" in name_lower else name_lower
        return f"Formats or renders {subject}."
    if name_lower.startswith("handle_") or name_lower.startswith("on_"):
        subject = name_lower.split("_", 1)[1].replace("_", " ") if "_" in name_lower else name_lower
        return f"Handles {subject} event."
    if name_lower.startswith("init") or name_lower.startswith("setup") or name_lower.startswith("bootstrap"):
        return "Initializes and configures the component."
    if name_lower in ("main", "__main__"):
        return "Entry point for the module."
    if name_lower.startswith("test_"):
        subject = name_lower[5:].replace("_", " ")
        return f"Tests {subject}."

    if sig:
        return f"Executes `{sig[:80]}`."

    return f"Implements `{name}` logic."


# ---------------------------------------------------------------------------
# INTENT.md generation
# ---------------------------------------------------------------------------


def generate_intent(project_root: str, only_modules: set | None = None) -> None:
    """Generate root INTENT.md and per-module INTENT.md files.

    If *only_modules* is provided, only regenerate views for those modules
    (incremental mode). The root INTENT.md is always regenerated when any
    module is affected.
    """
    abs_root = os.path.abspath(project_root)
    conn = get_connection(abs_root)
    try:
        modules = get_modules(conn)
        if not modules:
            print("No symbols found in database. Run the indexer first.", file=sys.stderr)
            conn.close()
            return

        project_name = Path(abs_root).name

        # Determine which modules to regenerate
        target_modules = set(modules.keys())
        if only_modules:
            target_modules = {m for m in modules if m in only_modules}

        # Always regenerate root INTENT.md when any module is touched
        if target_modules or not only_modules:
            _write_root_intent(conn, abs_root, project_name, modules)

        for module in target_modules:
            # Root-level files (module=".") are covered by the root INTENT.md
            # written above — skip to avoid overwriting it.
            if module == ".":
                continue
            files = modules[module]
            symbols = _get_symbols_for_module(conn, module, files)
            _write_module_intent(conn, abs_root, module, symbols)

        print(
            f"Generated INTENT.md for {len(target_modules)} module(s) + root.",
            file=sys.stderr,
        )
    finally:
        conn.close()


def _write_root_intent(conn, project_root: str, project_name: str, modules: dict) -> None:
    """Write the root-level INTENT.md."""
    rows = []
    for module, files in sorted(modules.items()):
        symbols = _get_symbols_for_module(conn, module, files)
        purpose = _infer_purpose(module, symbols)
        top = _top_symbols(symbols)
        key_fns = ", ".join(s["name"] for s in top) if top else "—"
        display = module if module != "." else "(root)"
        rows.append(f"| `{display}` | {purpose} | {key_fns} |")

    module_table = "\n".join(rows) if rows else "| — | No modules found | — |"

    content = f"""# {project_name} — Intent

## Vision

{project_name} is a codebase with {len(modules)} module(s). The structure below summarises each module's purpose and key entry points as derived from the code graph.

## Architecture Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Code indexing | SQLite + FTS5 | Persistent, queryable graph without external dependencies |
| Symbol extraction | tree-sitter | Language-agnostic AST parsing with multi-language support |
| Edge extraction | Aider-style def/ref with tags.scm | Reliable cross-language reference detection |
| Ranking | fast-pagerank with scipy sparse matrices | Hybrid file-level PageRank + symbol-level blast radius |
| Schema | 5-table (files, symbols, refs, file_edges, symbol_edges) | Separated concerns for file-level and symbol-level analysis |
| View generation | Markdown + Mermaid | Human-readable output compatible with most documentation tools |

## Module Map

| Module | Purpose | Key Functions |
|---|---|---|
{module_table}
"""

    out_path = os.path.join(project_root, "INTENT.md")
    _write_file(out_path, content)


def _write_module_intent(conn, project_root: str, module: str, symbols: list) -> None:
    """Write a per-module INTENT.md inside the module directory."""
    if not symbols:
        return

    module_name = module if module != "." else Path(project_root).name

    # Build function entries
    entries = []
    for sym in symbols:
        if sym["kind"] not in ("function", "method", "class", "definition"):
            continue

        does = _infer_function_does(sym)
        callers = _get_callers(conn, sym["id"])
        callees = _get_callees(conn, sym["id"])
        ref_count = _get_ref_count(conn, sym["name"])

        called_by_str = ", ".join(c["name"] for c in callers) if callers else "none found"
        calls_str = ", ".join(c["name"] for c in callees) if callees else "none found"

        entry = f"""## {sym["name"]}
- **Does**: {does}
- **Why**: Supports the `{module_name}` module's responsibilities.
- **Relationships**: calls [{calls_str}], called by [{called_by_str}]
- **References**: {ref_count} reference(s) across codebase
- **Decisions**: `{sym.get("signature", "") or sym["name"]}` (line {sym.get("start_line", "?")} – {sym.get("end_line", "?")})
"""
        entries.append(entry)

    if not entries:
        return

    content = f"# {module_name} — Intent\n\n" + "\n".join(entries)

    if module == ".":
        out_path = os.path.join(project_root, "INTENT.md")
    else:
        module_dir = os.path.join(project_root, module)
        os.makedirs(module_dir, exist_ok=True)
        out_path = os.path.join(module_dir, "INTENT.md")

    _write_file(out_path, content)


# ---------------------------------------------------------------------------
# ARCHITECTURE.mmd / DIAGRAM.mmd generation
# ---------------------------------------------------------------------------


def generate_diagrams(project_root: str, only_modules: set | None = None) -> None:
    """Generate root ARCHITECTURE.mmd and per-module DIAGRAM.mmd files.

    If *only_modules* is provided, only regenerate views for those modules.
    The root diagram is always regenerated when any module is affected.
    """
    abs_root = os.path.abspath(project_root)
    conn = get_connection(abs_root)
    try:
        modules = get_modules(conn)
        if not modules:
            print("No symbols found in database. Run the indexer first.", file=sys.stderr)
            conn.close()
            return

        target_modules = set(modules.keys())
        if only_modules:
            target_modules = {m for m in modules if m in only_modules}

        if target_modules or not only_modules:
            _write_root_diagram(conn, abs_root, modules)

        for module in target_modules:
            # Root-level files (module=".") are covered by ARCHITECTURE.mmd
            # written above — skip to avoid overwriting it.
            if module == ".":
                continue
            files = modules[module]
            symbols = _get_symbols_for_module(conn, module, files)
            _write_module_diagram(conn, abs_root, module, symbols)

        print(
            f"Generated diagrams for {len(target_modules)} module(s) + root.",
            file=sys.stderr,
        )
    finally:
        conn.close()


def _write_root_diagram(conn, project_root: str, modules: dict) -> None:
    """Write root ARCHITECTURE.mmd showing module-level dependencies.

    Uses the file_edges table for module-level dependency information,
    which is more efficient than walking symbol-level edges.
    """
    module_list = sorted(modules.keys())

    # Build a file_path -> module lookup
    file_to_module = {}
    for module, files in modules.items():
        for fp in files:
            file_to_module[fp] = module

    # Query file_edges and aggregate into module-level dependencies
    module_deps: dict = defaultdict(set)
    rows = conn.execute(
        """
        SELECT sf.path AS source_path, tf.path AS target_path, fe.weight
        FROM file_edges fe
        JOIN files sf ON sf.id = fe.source_file_id
        JOIN files tf ON tf.id = fe.target_file_id
        """
    ).fetchall()

    for row in rows:
        src_module = _get_module_for_path(row["source_path"])
        tgt_module = _get_module_for_path(row["target_path"])
        if src_module != tgt_module:
            module_deps[src_module].add(tgt_module)

    # Build mermaid lines
    lines = ["graph LR"]

    # Node declarations
    for m in module_list:
        safe_id = _mermaid_id(m)
        label = m if m != "." else "(root)"
        lines.append(f"    {safe_id}[{label}]")

    # Edge declarations
    edge_added = False
    for src_module in sorted(module_deps.keys()):
        for tgt_module in sorted(module_deps[src_module]):
            if tgt_module in modules:
                src_id = _mermaid_id(src_module)
                tgt_id = _mermaid_id(tgt_module)
                lines.append(f"    {src_id} --> {tgt_id}")
                edge_added = True

    if not edge_added and len(module_list) > 1:
        # No edges detected — add a comment so the diagram is still valid
        lines.append("    %% No inter-module dependencies detected in index")

    content = "```mermaid\n" + "\n".join(lines) + "\n```\n"
    out_path = os.path.join(project_root, "ARCHITECTURE.mmd")
    _write_file(out_path, content)


def _write_module_diagram(conn, project_root: str, module: str, symbols: list) -> None:
    """Write per-module DIAGRAM.mmd showing function-level call graph.

    Uses symbol_edges for intra-module edges.
    """
    if not symbols:
        return

    # Collect symbol IDs and names in this module
    sym_ids = {s["id"] for s in symbols}
    sym_names = {s["id"]: s["name"] for s in symbols}

    lines = ["graph TD"]

    # Node declarations for all symbols with interesting kinds
    interesting = [s for s in symbols if s["kind"] in ("function", "method", "class", "definition")]
    if not interesting:
        interesting = symbols

    for sym in interesting:
        safe_id = _mermaid_id(f"{sym['name']}_{sym['id']}")
        lines.append(f"    {safe_id}[{sym['name']}]")

    # Edge declarations — only intra-module edges via symbol_edges
    edges_added = False
    for sym in interesting:
        callees = _get_callees(conn, sym["id"])
        src_id = _mermaid_id(f"{sym['name']}_{sym['id']}")
        for callee_row in callees:
            # Find callee in this module's symbol set
            matching = [s for s in interesting if s["name"] == callee_row["name"]]
            for tgt_sym in matching:
                tgt_id = _mermaid_id(f"{tgt_sym['name']}_{tgt_sym['id']}")
                lines.append(f"    {src_id} --> {tgt_id}")
                edges_added = True

    if not edges_added and len(interesting) > 1:
        lines.append("    %% No intra-module call edges detected in index")

    content = "```mermaid\n" + "\n".join(lines) + "\n```\n"

    if module == ".":
        out_path = os.path.join(project_root, "DIAGRAM.mmd")
    else:
        module_dir = os.path.join(project_root, module)
        os.makedirs(module_dir, exist_ok=True)
        out_path = os.path.join(module_dir, "DIAGRAM.mmd")

    _write_file(out_path, content)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _mermaid_id(text: str) -> str:
    """Convert arbitrary text to a safe Mermaid node ID."""
    safe = ""
    for ch in text:
        if ch.isalnum() or ch == "_":
            safe += ch
        else:
            safe += "_"
    # Mermaid IDs cannot start with a digit
    if safe and safe[0].isdigit():
        safe = "_" + safe
    return safe or "_unknown"


def _write_file(path: str, content: str) -> None:
    """Write content to path, creating parent directories as needed."""
    os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def _files_to_modules(files_str: str) -> set:
    """Convert a comma-separated file list to a set of affected module names."""
    raw = [f.strip() for f in files_str.split(",") if f.strip()]
    return {_get_module_for_path(f) for f in raw}


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ftm-map view generators — produce INTENT.md and ARCHITECTURE.mmd from the code graph.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 views.py --intent --project-root /path/to/project\n"
            "  python3 views.py --diagram --project-root /path/to/project\n"
            "  python3 views.py --intent --files src/foo.ts,src/bar.py --project-root /path/to/project\n"
            "  python3 views.py --diagram --files src/foo.ts --project-root /path/to/project\n"
        ),
    )

    parser.add_argument(
        "--intent",
        action="store_true",
        help="Generate root INTENT.md and per-module INTENT.md files.",
    )
    parser.add_argument(
        "--diagram",
        action="store_true",
        help="Generate root ARCHITECTURE.mmd and per-module DIAGRAM.mmd files.",
    )
    parser.add_argument(
        "--project-root",
        metavar="PATH",
        default=os.getcwd(),
        help="Path to the project root directory (default: cwd).",
    )
    parser.add_argument(
        "--files",
        metavar="FILE_LIST",
        default=None,
        help="Comma-separated list of changed files (incremental mode — only regenerate affected modules).",
    )

    args = parser.parse_args()

    if not args.intent and not args.diagram:
        parser.print_help()
        sys.exit(1)

    only_modules: set | None = None
    if args.files:
        only_modules = _files_to_modules(args.files)

    if args.intent:
        generate_intent(args.project_root, only_modules)
    if args.diagram:
        generate_diagrams(args.project_root, only_modules)


if __name__ == "__main__":
    main()
