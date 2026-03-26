"""Tests for ranker.py -- PageRank context selection."""
import os
import sys
import tempfile
import pytest

sys.path.insert(0, os.path.dirname(__file__))
from db import get_connection, add_file, add_symbol, add_reference, rebuild_file_edges, rebuild_symbol_edges
from ranker import rank_files, fit_to_budget, build_adjacency_matrix, build_personalization


@pytest.fixture
def graph_conn():
    """Connection with a graph that has meaningful PageRank differences.

    Hub-and-spoke pattern: utils.py is referenced by 5 module files.
    One isolated file with no connections.
    """
    with tempfile.TemporaryDirectory() as tmp:
        conn = get_connection(tmp)

        # Hub file: utils.py with symbols that many files reference
        f_hub = add_file(conn, "src/utils.py", "python", 1.0, line_count=200)
        add_symbol(conn, f_hub, "format_date", "function", 1, 10)
        add_symbol(conn, f_hub, "validate", "function", 15, 30)

        spokes = []
        for i in range(5):
            f = add_file(conn, f"src/module_{i}.py", "python", 1.0, line_count=50)
            add_symbol(conn, f, f"handler_{i}", "function", 1, 20)
            add_reference(conn, f, "format_date", 10)
            add_reference(conn, f, "validate", 15)
            spokes.append(f)

        # One isolated file with no connections
        f_iso = add_file(conn, "src/isolated.py", "python", 1.0, line_count=10)
        add_symbol(conn, f_iso, "lonely_func", "function", 1, 5)

        rebuild_file_edges(conn)
        rebuild_symbol_edges(conn)
        conn.commit()

        yield conn
        conn.close()


class TestPageRank:
    def test_hub_ranked_higher(self, graph_conn):
        results = rank_files(graph_conn)
        assert len(results) > 0
        # utils.py (hub) should be ranked higher than isolated.py
        path_scores = {p: s for p, s in results}
        assert path_scores.get("src/utils.py", 0) > path_scores.get("src/isolated.py", 0)

    def test_all_files_ranked(self, graph_conn):
        results = rank_files(graph_conn)
        assert len(results) == 7  # 1 hub + 5 spokes + 1 isolated

    def test_scores_sum_to_one(self, graph_conn):
        results = rank_files(graph_conn)
        total = sum(s for _, s in results)
        assert abs(total - 1.0) < 0.01

    def test_returns_sorted_descending(self, graph_conn):
        results = rank_files(graph_conn)
        scores = [s for _, s in results]
        for i in range(len(scores) - 1):
            assert scores[i] >= scores[i + 1]

    def test_all_scores_positive(self, graph_conn):
        results = rank_files(graph_conn)
        for _, score in results:
            assert score > 0


class TestPersonalization:
    def test_seed_file_boosts(self, graph_conn):
        uniform = rank_files(graph_conn)
        personalized = rank_files(graph_conn, seed_files=["src/isolated.py"])

        u_score = dict(uniform).get("src/isolated.py", 0)
        p_score = dict(personalized).get("src/isolated.py", 0)
        assert p_score > u_score  # Seeded file should get boosted

    def test_seed_symbol_boosts(self, graph_conn):
        uniform = rank_files(graph_conn)
        personalized = rank_files(graph_conn, seed_symbols=["format_date"])

        u_score = dict(uniform).get("src/utils.py", 0)
        p_score = dict(personalized).get("src/utils.py", 0)
        # utils.py defines format_date, should stay high or increase
        assert p_score >= u_score * 0.9  # Allow small variance

    def test_seed_keyword_boosts(self, graph_conn):
        uniform = rank_files(graph_conn)
        personalized = rank_files(graph_conn, seed_keywords=["format_date"])

        p_scores = dict(personalized)
        u_scores = dict(uniform)
        # utils.py has format_date symbol, should be boosted
        assert p_scores.get("src/utils.py", 0) >= u_scores.get("src/utils.py", 0) * 0.9


class TestBudgetFitting:
    def test_respects_budget(self, graph_conn):
        ranked = rank_files(graph_conn)
        result, tokens = fit_to_budget(ranked, graph_conn, 100)
        assert tokens <= 100 * 1.15  # 15% tolerance

    def test_returns_file_entries(self, graph_conn):
        ranked = rank_files(graph_conn)
        result, _ = fit_to_budget(ranked, graph_conn, 500)
        assert len(result) > 0
        assert "symbols" in result[0]
        assert "path" in result[0]
        assert "score" in result[0]
        assert "tokens" in result[0]

    def test_zero_budget(self, graph_conn):
        ranked = rank_files(graph_conn)
        result, tokens = fit_to_budget(ranked, graph_conn, 0)
        assert result == []
        assert tokens == 0

    def test_large_budget_includes_all(self, graph_conn):
        ranked = rank_files(graph_conn)
        result, _ = fit_to_budget(ranked, graph_conn, 100000)
        assert len(result) == len(ranked)

    def test_symbols_populated(self, graph_conn):
        ranked = rank_files(graph_conn)
        result, _ = fit_to_budget(ranked, graph_conn, 500)
        # At least some entries should have symbols
        has_symbols = any(len(entry["symbols"]) > 0 for entry in result)
        assert has_symbols

    def test_empty_ranked_list(self, graph_conn):
        result, tokens = fit_to_budget([], graph_conn, 500)
        assert result == []
        assert tokens == 0


class TestAdjacencyMatrix:
    def test_builds_sparse_matrix(self, graph_conn):
        adj, fid_to_idx, idx_to_fid = build_adjacency_matrix(graph_conn)
        assert adj is not None
        assert adj.shape[0] == 7  # 7 files
        assert adj.nnz > 0  # Has edges

    def test_index_mappings_consistent(self, graph_conn):
        adj, fid_to_idx, idx_to_fid = build_adjacency_matrix(graph_conn)
        assert len(fid_to_idx) == 7
        assert len(idx_to_fid) == 7
        # Forward and reverse should be inverses
        for fid, idx in fid_to_idx.items():
            assert idx_to_fid[idx] == fid

    def test_matrix_is_symmetric(self, graph_conn):
        """Adjacency matrix should be symmetrized (undirected)."""
        adj, _, _ = build_adjacency_matrix(graph_conn)
        diff = abs(adj - adj.T)
        assert diff.nnz == 0 or diff.max() < 1e-10


class TestBuildPersonalization:
    def test_uniform_baseline(self, graph_conn):
        _, fid_to_idx, _ = build_adjacency_matrix(graph_conn)
        pers = build_personalization(graph_conn, file_id_to_idx=fid_to_idx)
        assert abs(pers.sum() - 1.0) < 1e-6  # Normalized

    def test_seed_file_increases_weight(self, graph_conn):
        _, fid_to_idx, _ = build_adjacency_matrix(graph_conn)
        uniform = build_personalization(graph_conn, file_id_to_idx=fid_to_idx)
        seeded = build_personalization(
            graph_conn, seed_files=["src/isolated.py"], file_id_to_idx=fid_to_idx
        )
        # Find the isolated file's index
        iso_row = graph_conn.execute(
            "SELECT id FROM files WHERE path='src/isolated.py'"
        ).fetchone()
        idx = fid_to_idx[iso_row["id"]]
        assert seeded[idx] > uniform[idx]


class TestEmptyDatabase:
    def test_rank_files_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = get_connection(tmp)
            results = rank_files(conn)
            assert results == []
            conn.close()

    def test_fit_to_budget_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = get_connection(tmp)
            result, tokens = fit_to_budget([], conn, 500)
            assert result == []
            assert tokens == 0
            conn.close()
