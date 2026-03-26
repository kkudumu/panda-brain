#!/usr/bin/env python3
"""ftm-map indexer: builds the code knowledge graph from source files.

Two-phase indexing:
  Phase 1 — Parse each file with tree-sitter, insert file/symbol/ref rows.
  Phase 2 — Materialize file_edges with Aider-style weight heuristics and
             symbol_edges via enclosing-scope resolution.
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# Add scripts dir to path for sibling imports
sys.path.insert(0, os.path.dirname(__file__))

from db import (
    get_connection,
    add_file,
    add_symbol,
    add_reference,
    remove_file,
    get_stats,
    rebuild_symbol_edges,
)
from parser import get_tags, detect_language, EXTENSION_MAP, compute_content_hash

META_REGISTRY = os.path.expanduser("~/.claude/ftm-state/maps/index.json")


# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------


def discover_files(project_root: str) -> list[str]:
    """Get tracked source files using git ls-files.

    Filters to files whose extensions are in EXTENSION_MAP so only
    tree-sitter-parseable files are returned. Returns absolute paths.
    """
    result = subprocess.run(
        ["git", "ls-files"],
        capture_output=True,
        text=True,
        cwd=project_root,
    )
    if result.returncode != 0:
        print(
            f"Error: git ls-files failed: {result.stderr.strip()}",
            file=sys.stderr,
        )
        return []

    supported_exts = set(EXTENSION_MAP.keys())
    files = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        ext = Path(line).suffix.lower()
        if ext in supported_exts:
            files.append(os.path.join(project_root, line))
    return files


# ---------------------------------------------------------------------------
# Core indexing logic
# ---------------------------------------------------------------------------


def index_files(conn, files: list[str], project_root: str) -> dict:
    """Parse and insert files, symbols, references, then materialize edges.

    Phase 1 — For each file: read source, compute hash, insert file row,
              extract def/ref tags via tree-sitter, insert symbol and ref rows.
    Phase 2 — Build file_edges with Aider weight heuristics (long descriptive
              names 10x, private 0.1x, overloaded 0.1x, sqrt-dampened counts).
              Then rebuild symbol_edges via enclosing-scope resolution.

    Returns a dict with symbols, references, file_edges, symbol_edges counts.
    """
    total_symbols = 0
    total_refs = 0

    # ------------------------------------------------------------------
    # Phase 1: parse each file and insert rows
    # ------------------------------------------------------------------
    for fpath in files:
        if not os.path.exists(fpath):
            print(f"Warning: file not found, skipping: {fpath}", file=sys.stderr)
            continue

        rel_path = os.path.relpath(fpath, project_root)
        lang = detect_language(fpath)
        mtime = os.path.getmtime(fpath)

        # Stream-friendly: read once, extract metadata, then release
        try:
            with open(fpath, "r", encoding="utf-8", errors="replace") as fh:
                source = fh.read()
        except (IOError, OSError) as exc:
            print(f"Warning: Cannot read {fpath}: {exc}", file=sys.stderr)
            continue

        line_count = source.count("\n") + 1
        content_hash = compute_content_hash(source)

        # Insert file record
        file_id = add_file(
            conn, rel_path, lang, mtime,
            hash=content_hash, line_count=line_count,
        )

        # Extract def/ref tags via tree-sitter
        tags = get_tags(fpath, rel_path)

        for tag in tags:
            if tag.kind == "def":
                add_symbol(conn, file_id, tag.name, "definition", tag.line, signature=None)
                total_symbols += 1
            elif tag.kind == "ref":
                add_reference(conn, file_id, tag.name, tag.line, kind="call")
                total_refs += 1

    # ------------------------------------------------------------------
    # Phase 2: materialize edges
    # ------------------------------------------------------------------

    # Build defines map: ident -> set of file_ids that define it
    defines = {}
    for row in conn.execute("SELECT name, file_id FROM symbols").fetchall():
        defines.setdefault(row["name"], set()).add(row["file_id"])

    # Build references map: ident -> list of file_ids that reference it
    references_map = {}
    for row in conn.execute("SELECT symbol_name, file_id FROM refs").fetchall():
        references_map.setdefault(row["symbol_name"], []).append(row["file_id"])

    # Materialize file_edges with Aider weight heuristics
    conn.execute("DELETE FROM file_edges")

    for ident, ref_file_ids in references_map.items():
        definers = defines.get(ident, set())
        if not definers:
            continue

        # Aider weight heuristics
        mul = 1.0
        # Long descriptive names (camelCase or snake_case, >= 8 chars) weighted higher
        if len(ident) >= 8 and re.match(r"[a-z_]+[A-Z]|[a-z]+_[a-z]", ident):
            mul *= 10
        # Private names weighted lower
        if ident.startswith("_"):
            mul *= 0.1
        # Overloaded names (defined in many files) weighted lower
        if len(definers) >= 5:
            mul *= 0.1

        # Count refs per file, then create weighted edges
        ref_counts = Counter(ref_file_ids)

        for ref_file_id, count in ref_counts.items():
            weight = mul * math.sqrt(count)
            for def_file_id in definers:
                if ref_file_id != def_file_id:  # No self-edges
                    conn.execute(
                        """INSERT INTO file_edges (source_file_id, target_file_id, weight)
                           VALUES (?, ?, ?)
                           ON CONFLICT(source_file_id, target_file_id)
                           DO UPDATE SET weight = MAX(weight, excluded.weight)""",
                        (ref_file_id, def_file_id, weight),
                    )

    # Materialize symbol_edges via enclosing-scope resolution
    rebuild_symbol_edges(conn)

    # Gather edge counts
    file_edge_count = conn.execute("SELECT COUNT(*) FROM file_edges").fetchone()[0]
    symbol_edge_count = conn.execute("SELECT COUNT(*) FROM symbol_edges").fetchone()[0]

    return {
        "symbols": total_symbols,
        "references": total_refs,
        "file_edges": file_edge_count,
        "symbol_edges": symbol_edge_count,
    }


# ---------------------------------------------------------------------------
# Bootstrap mode
# ---------------------------------------------------------------------------


def bootstrap(project_root: str) -> None:
    """Full scan: (re)build the entire code graph for *project_root*."""
    abs_root = os.path.abspath(project_root)
    start = time.time()

    files = discover_files(abs_root)
    if not files:
        print(
            json.dumps({"error": "No parseable source files found in git repository"}),
            file=sys.stderr,
        )
        sys.exit(1)

    conn = get_connection(abs_root)
    try:
        # Full rebuild — clear all tables. CASCADE handles symbols, refs, edges.
        # FTS5 rows must be removed before symbol rows (content= table).
        symbol_ids = [
            row[0] for row in conn.execute("SELECT id FROM symbols").fetchall()
        ]
        for sid in symbol_ids:
            conn.execute("DELETE FROM symbols_fts WHERE rowid=?", (sid,))
        conn.execute("DELETE FROM files")

        stats = index_files(conn, files, abs_root)
        conn.commit()

        duration = time.time() - start
        result = {
            "mode": "bootstrap",
            "files_parsed": len(files),
            "symbols": stats["symbols"],
            "references": stats["references"],
            "file_edges": stats["file_edges"],
            "symbol_edges": stats["symbol_edges"],
            "duration_s": round(duration, 2),
        }
        print(json.dumps(result))
        update_meta_registry(abs_root, stats["symbols"])
    except Exception as exc:  # noqa: BLE001
        print(f"Error during bootstrap: {exc}", file=sys.stderr)
        conn.rollback()
        conn.close()
        sys.exit(1)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Incremental mode
# ---------------------------------------------------------------------------


def incremental(project_root: str, files_str: str) -> None:
    """Incremental update: re-index only the specified files.

    *files_str* is a comma-separated list of file paths (relative or absolute).
    Old file/symbol/ref/edge data for each file is cascade-deleted via
    remove_file() before re-parsing so stale entries do not accumulate.
    All edges are rebuilt since changes can ripple across files.
    """
    abs_root = os.path.abspath(project_root)
    start = time.time()

    raw_files = [f.strip() for f in files_str.split(",") if f.strip()]
    abs_files = [
        f if os.path.isabs(f) else os.path.join(abs_root, f) for f in raw_files
    ]

    conn = get_connection(abs_root)
    try:
        # Remove stale data for all targeted files (cascading delete).
        for fpath in abs_files:
            rel_path = os.path.relpath(fpath, abs_root)
            remove_file(conn, rel_path)

        existing_files = [f for f in abs_files if os.path.exists(f)]
        if not existing_files:
            print(
                json.dumps({"error": "None of the specified files exist"}),
                file=sys.stderr,
            )
            conn.close()
            sys.exit(1)

        stats = index_files(conn, existing_files, abs_root)
        conn.commit()

        db_stats = get_stats(conn)
        duration = time.time() - start
        result = {
            "mode": "incremental",
            "files_parsed": len(existing_files),
            "symbols": stats["symbols"],
            "references": stats["references"],
            "file_edges": stats["file_edges"],
            "symbol_edges": stats["symbol_edges"],
            "duration_s": round(duration, 2),
        }
        print(json.dumps(result))
        update_meta_registry(abs_root, db_stats["symbol_count"])
    except Exception as exc:  # noqa: BLE001
        print(f"Error during incremental update: {exc}", file=sys.stderr)
        conn.rollback()
        conn.close()
        sys.exit(1)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Meta-registry management
# ---------------------------------------------------------------------------


def update_meta_registry(project_root: str, symbol_count: int) -> None:
    """Upsert project entry in the global meta-registry at META_REGISTRY."""
    registry_dir = os.path.dirname(META_REGISTRY)
    os.makedirs(registry_dir, exist_ok=True)

    registry: dict = {"projects": []}
    if os.path.exists(META_REGISTRY):
        try:
            with open(META_REGISTRY) as fh:
                registry = json.load(fh)
        except (json.JSONDecodeError, IOError):
            # Corrupt or unreadable registry — start fresh.
            registry = {"projects": []}

    abs_root = os.path.abspath(project_root)
    db_path = os.path.join(abs_root, ".ftm-map", "map.db")
    now = datetime.now(timezone.utc).isoformat()

    found = False
    for proj in registry["projects"]:
        if proj.get("path") == abs_root:
            proj["last_indexed"] = now
            proj["symbol_count"] = symbol_count
            found = True
            break

    if not found:
        registry["projects"].append(
            {
                "path": abs_root,
                "db_path": db_path,
                "last_indexed": now,
                "symbol_count": symbol_count,
            }
        )

    with open(META_REGISTRY, "w") as fh:
        json.dump(registry, fh, indent=2)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="ftm-map indexer — builds the code knowledge graph from source files.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 index.py --bootstrap /path/to/project\n"
            "  python3 index.py --incremental --files src/foo.ts,src/bar.py\n"
            "  python3 index.py --incremental --files src/foo.ts --project-root /path/to/project\n"
        ),
    )

    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--bootstrap",
        metavar="PROJECT_ROOT",
        help="Full scan: index all tracked source files in PROJECT_ROOT.",
    )
    mode.add_argument(
        "--incremental",
        action="store_true",
        help="Incremental update: re-index only the files given by --files.",
    )

    parser.add_argument(
        "--files",
        metavar="FILE_LIST",
        help="Comma-separated list of files to re-index (required for --incremental).",
    )
    parser.add_argument(
        "--project-root",
        metavar="PATH",
        default=None,
        help=(
            "Project root used to locate the database for incremental mode. "
            "Defaults to the current working directory."
        ),
    )

    args = parser.parse_args()

    if args.bootstrap:
        bootstrap(args.bootstrap)
    else:
        # Incremental mode
        if not args.files:
            print("Error: --incremental requires --files", file=sys.stderr)
            sys.exit(1)
        project_root = args.project_root or os.getcwd()
        incremental(project_root, args.files)


if __name__ == "__main__":
    main()
