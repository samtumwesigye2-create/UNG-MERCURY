from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

DB_PATH = Path(__file__).with_name("mercury_review.db")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_review_store() -> None:
    with _conn() as c:
        c.execute("""
        CREATE TABLE IF NOT EXISTS manual_review_queue(
            review_id TEXT PRIMARY KEY,
            capture_id TEXT NOT NULL UNIQUE,
            idempotency_key TEXT NOT NULL UNIQUE,
            payload_json TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            claimed_by TEXT,
            claimed_at TEXT,
            resolved_by TEXT,
            resolved_at TEXT,
            resolution TEXT,
            created_at TEXT NOT NULL
        )
        """)


def enqueue_review(capture: dict[str, Any], reason: str) -> dict[str, Any]:
    init_review_store()
    review_id = str(uuid4())
    with _conn() as c:
        existing = c.execute("SELECT * FROM manual_review_queue WHERE idempotency_key=?", (capture["idempotency_key"],)).fetchone()
        if existing:
            return {**dict(existing), "duplicate": True}
        c.execute(
            "INSERT INTO manual_review_queue(review_id,capture_id,idempotency_key,payload_json,reason,status,created_at) VALUES(?,?,?,?,?,'open',?)",
            (review_id, capture["capture_id"], capture["idempotency_key"], json.dumps(capture, separators=(",", ":")), reason, _now()),
        )
        row = c.execute("SELECT * FROM manual_review_queue WHERE review_id=?", (review_id,)).fetchone()
    return {**dict(row), "duplicate": False}


def list_reviews(status: str = "open", limit: int = 100) -> list[dict[str, Any]]:
    init_review_store()
    with _conn() as c:
        rows = c.execute("SELECT * FROM manual_review_queue WHERE status=? ORDER BY created_at ASC LIMIT ?", (status, limit)).fetchall()
    return [dict(r) for r in rows]


def claim_review(review_id: str, operator_id: str) -> dict[str, Any] | None:
    init_review_store()
    with _conn() as c:
        c.execute("UPDATE manual_review_queue SET status='claimed',claimed_by=?,claimed_at=? WHERE review_id=? AND status='open'", (operator_id, _now(), review_id))
        row = c.execute("SELECT * FROM manual_review_queue WHERE review_id=?", (review_id,)).fetchone()
    return dict(row) if row else None


def resolve_review(review_id: str, operator_id: str, resolution: str) -> dict[str, Any] | None:
    init_review_store()
    with _conn() as c:
        c.execute("UPDATE manual_review_queue SET status='resolved',resolved_by=?,resolved_at=?,resolution=? WHERE review_id=? AND status IN ('open','claimed')", (operator_id, _now(), resolution, review_id))
        row = c.execute("SELECT * FROM manual_review_queue WHERE review_id=?", (review_id,)).fetchone()
    return dict(row) if row else None
