#!/usr/bin/env python3
"""ftm-map indexer: builds the code knowledge graph from source files."""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Add scripts dir to path for sibling imports
sys.path.insert(0, os.path.dirname(__file__))

from db import (
    get_connection,
    add_symbol,
    remove_symbols_by_file,
    add_edge,
    get_symbol_by_name,
    get_stats,
)
from parser import parse_file, extract_relationships, EXTENSION_MAP

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
    """Parse and insert symbols + edges for a list of absolute file paths.

    Two-phase approach:
      Phase 1 — parse every file and insert all symbols so that the
                 symbol table is fully populated before edge resolution.
      Phase 2 — extract relationships and resolve source/target names to
                 existing symbol IDs.  Unknown targets are silently skipped.

    Returns a dict with 'symbols' and 'edges' counts.
    """
    total_symbols = 0
    total_edges = 0

    # Phase 1: insert all symbols first so cross-file edges can be resolved.
    for fpath in files:
        if not os.path.exists(fpath):
            print(f"Warning: file not found, skipping: {fpath}", file=sys.stderr)
            continue

        rel_path = os.path.relpath(fpath, project_root)
        symbols = parse_file(fpath)

        for sym in symbols:
            add_symbol(
                conn,
                name=sym.name,
                kind=sym.kind,
                file_path=rel_path,
                start_line=sym.start_line,
                end_line=sym.end_line,
                signature=sym.signature,
                doc_comment=sym.doc_comment,
                content_hash=sym.content_hash,
            )
            total_symbols += 1

    # Phase 2: resolve and insert edges.
    for fpath in files:
        if not os.path.exists(fpath):
            continue

        rels = extract_relationships(fpath)
        for rel in rels:
            source_rows = get_symbol_by_name(conn, rel.source_name)
            target_rows = get_symbol_by_name(conn, rel.target_name)

            # Skip if either end of the relationship is unresolvable.
            if not source_rows or not target_rows:
                continue

            add_edge(conn, source_rows[0]["id"], target_rows[0]["id"], rel.kind)
            total_edges += 1

    return {"symbols": total_symbols, "edges": total_edges}


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
        # Full rebuild — clear existing content first.
        # FTS5 rows must be removed before symbol rows because the content=
        # table does not cascade deletes.
        symbol_ids = [
            row[0] for row in conn.execute("SELECT id FROM symbols").fetchall()
        ]
        for sid in symbol_ids:
            conn.execute("DELETE FROM symbols_fts WHERE rowid=?", (sid,))
        conn.execute("DELETE FROM symbols")
        conn.execute("DELETE FROM edges")

        stats = index_files(conn, files, abs_root)
        conn.commit()

        duration = time.time() - start
        result = {
            "mode": "bootstrap",
            "files_parsed": len(files),
            "symbols": stats["symbols"],
            "edges": stats["edges"],
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
    Old symbol/edge data for each file is removed before re-parsing so stale
    entries do not accumulate.
    """
    abs_root = os.path.abspath(project_root)
    start = time.time()

    raw_files = [f.strip() for f in files_str.split(",") if f.strip()]
    abs_files = [
        f if os.path.isabs(f) else os.path.join(abs_root, f) for f in raw_files
    ]

    conn = get_connection(abs_root)
    try:
        # Remove stale data for all targeted files before re-parsing.
        for fpath in abs_files:
            rel_path = os.path.relpath(fpath, abs_root)
            remove_symbols_by_file(conn, rel_path)

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
            "edges": stats["edges"],
            "duration_s": round(duration, 2),
        }
        print(json.dumps(result))
        update_meta_registry(abs_root, db_stats["symbols"])
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
