#!/usr/bin/env python3
"""ftm-map query interface: structural and text queries against the code graph."""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from db import get_connection, get_symbol_by_name, get_transitive_deps, get_reverse_deps, fts_search


def blast_radius(conn, symbol_name: str, max_depth: int = 10) -> dict:
    """Get all symbols that would be affected if this symbol changes."""
    symbols = get_symbol_by_name(conn, symbol_name)
    if not symbols:
        return {"error": f"Symbol '{symbol_name}' not found", "results": []}

    # Use first match
    sym = symbols[0]
    deps = get_reverse_deps(conn, sym["id"], max_depth)

    return {
        "symbol": symbol_name,
        "symbol_file": sym["file_path"],
        "affected_count": len(deps),
        "results": deps,
    }


def dependency_chain(conn, symbol_name: str, max_depth: int = 10) -> dict:
    """Get all symbols this one depends on."""
    symbols = get_symbol_by_name(conn, symbol_name)
    if not symbols:
        return {"error": f"Symbol '{symbol_name}' not found", "results": []}

    sym = symbols[0]
    deps = get_transitive_deps(conn, sym["id"], max_depth)

    return {
        "symbol": symbol_name,
        "symbol_file": sym["file_path"],
        "dependency_count": len(deps),
        "results": deps,
    }


def search(conn, query_text: str, limit: int = 10) -> dict:
    """BM25-ranked full-text search."""
    results = fts_search(conn, query_text, limit)
    return {
        "query": query_text,
        "result_count": len(results),
        "results": results,
    }


def symbol_info(conn, symbol_name: str) -> dict:
    """Full details about a symbol including callers, callees, and blast radius count."""
    symbols = get_symbol_by_name(conn, symbol_name)
    if not symbols:
        return {"error": f"Symbol '{symbol_name}' not found"}

    sym = symbols[0]
    sym_id = sym["id"]

    # Direct callers (who calls me)
    callers = conn.execute(
        """
        SELECT s.name, s.kind, s.file_path, s.start_line
        FROM edges e JOIN symbols s ON s.id = e.source_id
        WHERE e.target_id = ?
        """,
        (sym_id,),
    ).fetchall()

    # Direct callees (who do I call)
    callees = conn.execute(
        """
        SELECT s.name, s.kind, s.file_path, s.start_line
        FROM edges e JOIN symbols s ON s.id = e.target_id
        WHERE e.source_id = ?
        """,
        (sym_id,),
    ).fetchall()

    # Blast radius count
    blast = get_reverse_deps(conn, sym_id)

    return {
        "name": sym["name"],
        "kind": sym["kind"],
        "file": sym["file_path"],
        "start_line": sym["start_line"],
        "end_line": sym["end_line"],
        "signature": sym.get("signature", ""),
        "doc_comment": sym.get("doc_comment", ""),
        "callers": [dict(r) for r in callers],
        "callees": [dict(r) for r in callees],
        "blast_radius_count": len(blast),
    }


def main():
    parser = argparse.ArgumentParser(description="ftm-map query interface")
    parser.add_argument(
        "--blast-radius", metavar="SYMBOL", help="Show blast radius for a symbol"
    )
    parser.add_argument(
        "--deps", metavar="SYMBOL", help="Show dependency chain for a symbol"
    )
    parser.add_argument("--search", metavar="QUERY", help="Full-text search")
    parser.add_argument("--info", metavar="SYMBOL", help="Full symbol info")
    parser.add_argument(
        "--limit", type=int, default=10, help="Result limit for search"
    )
    parser.add_argument(
        "--max-depth", type=int, default=10, help="Max traversal depth"
    )
    parser.add_argument(
        "--project-root",
        default=os.getcwd(),
        help="Project root directory",
    )

    args = parser.parse_args()

    conn = get_connection(args.project_root)
    try:
        if args.blast_radius:
            result = blast_radius(conn, args.blast_radius, args.max_depth)
        elif args.deps:
            result = dependency_chain(conn, args.deps, args.max_depth)
        elif args.search:
            result = search(conn, args.search, args.limit)
        elif args.info:
            result = symbol_info(conn, args.info)
        else:
            parser.print_help()
            sys.exit(1)

        print(json.dumps(result, indent=2, default=str))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
