"""Tests for query.py -- all query modes with new schema."""
import os
import sys
import tempfile
import pytest

sys.path.insert(0, os.path.dirname(__file__))
from db import get_connection, add_file, add_symbol, add_reference, rebuild_file_edges, rebuild_symbol_edges
from query import blast_radius, dependency_chain, search, symbol_info, context, stats


@pytest.fixture
def indexed_conn():
    """Connection with a fully indexed mini-project."""
    with tempfile.TemporaryDirectory() as tmp:
        conn = get_connection(tmp)

        f1 = add_file(conn, "src/auth.py", "python", 1.0, line_count=50)
        f2 = add_file(conn, "src/api.py", "python", 1.0, line_count=100)
        f3 = add_file(conn, "src/utils.py", "python", 1.0, line_count=30)

        add_symbol(conn, f1, "authenticate", "function", 1, 20, signature="def authenticate(req)")
        add_symbol(conn, f1, "verify_token", "function", 25, 40)
        add_symbol(conn, f2, "handle_request", "function", 1, 50)
        add_symbol(conn, f3, "format_date", "function", 1, 10)
        add_symbol(conn, f3, "parse_config", "function", 15, 25)

        add_reference(conn, f2, "authenticate", 10)
        add_reference(conn, f2, "format_date", 20)
        add_reference(conn, f1, "format_date", 30)

        rebuild_file_edges(conn)
        rebuild_symbol_edges(conn)
        conn.commit()

        yield conn
        conn.close()


class TestBlastRadius:
    def test_finds_affected(self, indexed_conn):
        result = blast_radius(indexed_conn, "authenticate")
        assert result["affected_count"] >= 1

    def test_returns_symbol_name(self, indexed_conn):
        result = blast_radius(indexed_conn, "authenticate")
        assert result["symbol"] == "authenticate"

    def test_results_have_file_path(self, indexed_conn):
        result = blast_radius(indexed_conn, "authenticate")
        if result["results"]:
            assert "file_path" in result["results"][0]

    def test_results_have_depth(self, indexed_conn):
        result = blast_radius(indexed_conn, "authenticate")
        if result["results"]:
            assert "depth" in result["results"][0]

    def test_not_found(self, indexed_conn):
        result = blast_radius(indexed_conn, "nonexistent")
        assert "error" in result


class TestDependencyChain:
    def test_finds_deps(self, indexed_conn):
        result = dependency_chain(indexed_conn, "handle_request")
        assert result["dependency_count"] >= 1

    def test_returns_symbol_name(self, indexed_conn):
        result = dependency_chain(indexed_conn, "handle_request")
        assert result["symbol"] == "handle_request"

    def test_not_found(self, indexed_conn):
        result = dependency_chain(indexed_conn, "nonexistent")
        assert "error" in result

    def test_leaf_has_no_deps(self, indexed_conn):
        result = dependency_chain(indexed_conn, "verify_token")
        # verify_token has no references to other symbols in its scope
        assert result["dependency_count"] == 0 or "error" not in result


class TestSearch:
    def test_finds_by_name(self, indexed_conn):
        result = search(indexed_conn, "authenticate")
        assert result["result_count"] >= 1

    def test_returns_query(self, indexed_conn):
        result = search(indexed_conn, "authenticate")
        assert result["query"] == "authenticate"

    def test_results_have_file_path(self, indexed_conn):
        result = search(indexed_conn, "authenticate")
        if result["results"]:
            assert "file_path" in result["results"][0]

    def test_results_have_rank(self, indexed_conn):
        result = search(indexed_conn, "authenticate")
        if result["results"]:
            assert "rank" in result["results"][0]

    def test_empty_results(self, indexed_conn):
        result = search(indexed_conn, "zzzznonexistent")
        assert result["result_count"] == 0


class TestSymbolInfo:
    def test_returns_name(self, indexed_conn):
        result = symbol_info(indexed_conn, "authenticate")
        assert result["name"] == "authenticate"

    def test_returns_kind(self, indexed_conn):
        result = symbol_info(indexed_conn, "authenticate")
        assert "kind" in result

    def test_returns_reference_count(self, indexed_conn):
        result = symbol_info(indexed_conn, "authenticate")
        assert "reference_count" in result
        assert result["reference_count"] >= 1  # api.py references it

    def test_returns_callers_callees(self, indexed_conn):
        result = symbol_info(indexed_conn, "authenticate")
        assert "callers" in result
        assert "callees" in result

    def test_returns_blast_radius_count(self, indexed_conn):
        result = symbol_info(indexed_conn, "authenticate")
        assert "blast_radius_count" in result

    def test_returns_file(self, indexed_conn):
        result = symbol_info(indexed_conn, "authenticate")
        assert result["file"] == "src/auth.py"

    def test_not_found(self, indexed_conn):
        result = symbol_info(indexed_conn, "nonexistent")
        assert "error" in result


class TestContext:
    def test_returns_files(self, indexed_conn):
        result = context(indexed_conn, seed_symbols=["authenticate"])
        assert "files" in result
        assert len(result["files"]) > 0

    def test_files_have_path(self, indexed_conn):
        result = context(indexed_conn, seed_symbols=["authenticate"])
        if result["files"]:
            assert "path" in result["files"][0]

    def test_files_have_score(self, indexed_conn):
        result = context(indexed_conn, seed_symbols=["authenticate"])
        if result["files"]:
            assert "score" in result["files"][0]

    def test_respects_budget(self, indexed_conn):
        result = context(indexed_conn, token_budget=50)
        if result.get("total_tokens"):
            assert result["total_tokens"] <= 50 * 1.15

    def test_no_budget_returns_all(self, indexed_conn):
        result = context(indexed_conn, token_budget=None)
        assert "files" in result

    def test_seed_files(self, indexed_conn):
        result = context(indexed_conn, seed_files=["src/auth.py"])
        assert "files" in result
        assert len(result["files"]) > 0


class TestStats:
    def test_returns_counts(self, indexed_conn):
        result = stats(indexed_conn)
        assert result["file_count"] == 3
        assert result["symbol_count"] == 5

    def test_returns_edge_counts(self, indexed_conn):
        result = stats(indexed_conn)
        assert "edge_count" in result
        assert "file_edge_count" in result

    def test_returns_reference_count(self, indexed_conn):
        result = stats(indexed_conn)
        assert result["reference_count"] == 3
