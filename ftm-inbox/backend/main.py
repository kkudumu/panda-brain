"""
ftm-inbox FastAPI application entry point.

Default port: 8042 (override via FTM_INBOX_PORT env var).

Startup sequence:
  1. Open SQLite connection (WAL mode)
  2. Initialize schema (idempotent CREATE TABLE IF NOT EXISTS)
  3. Load adapter registry from config.yml (warn if missing, don't crash)
  4. Register API routes

CORS allows all localhost origins for development.
"""

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.connection import get_connection
from backend.db.schema import initialize_schema
from backend.routes.health import router as health_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("ftm-inbox")

app = FastAPI(
    title="FTM Inbox",
    description="Operator Cockpit backend — aggregates tasks from all connected sources.",
    version="0.1.0",
)

# CORS: allow all localhost origins (frontend dev server + any local tooling)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup() -> None:
    logger.info("Starting ftm-inbox backend…")

    # 1. Open DB and initialize schema
    conn = get_connection()
    initialize_schema(conn)
    logger.info("Database initialized.")

    # 2. Load adapter registry (non-fatal if config.yml is missing)
    try:
        from backend.adapters.registry import AdapterRegistry
        registry = AdapterRegistry.from_config()
        app.state.adapter_registry = registry
        logger.info("Adapter registry loaded: %s", registry)
    except Exception as exc:
        logger.warning("Adapter registry failed to load: %s", exc)
        app.state.adapter_registry = None


@app.on_event("shutdown")
async def shutdown() -> None:
    from backend.db.connection import close_connection
    close_connection()
    logger.info("Database connection closed.")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

app.include_router(health_router)


# ---------------------------------------------------------------------------
# Dev entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("FTM_INBOX_PORT", "8042"))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
