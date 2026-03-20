"""
Health check endpoint for ftm-inbox backend.

GET /health
  Returns 200 with status, version, and DB connectivity check.
"""

import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

router = APIRouter()


def _check_db(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("SELECT 1").fetchone()
        return True
    except Exception:
        return False


@router.get("/health")
async def health_check() -> JSONResponse:
    """
    Returns backend health status.

    Does not depend on the adapter registry — just confirms the process
    is alive and the database is reachable.
    """
    from backend.db.connection import get_connection

    db_ok = False
    try:
        conn = get_connection()
        db_ok = _check_db(conn)
    except Exception:
        db_ok = False

    status = "ok" if db_ok else "degraded"
    code = 200 if db_ok else 503

    return JSONResponse(
        status_code=code,
        content={
            "status": status,
            "db": "ok" if db_ok else "unreachable",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
