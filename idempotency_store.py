from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Optional

DB_PATH = os.getenv("MERCURY_DB_PATH", "mercury.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_idempotency_store() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS idempotency_records (
                idempotency_key TEXT PRIMARY KEY,
                response_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


def get_idempotent_response(idempotency_key: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT response_json FROM idempotency_records WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
    return json.loads(row["response_json"]) if row else None


def store_idempotent_response(idempotency_key: str, response: dict) -> dict:
    encoded = json.dumps(response, separators=(",", ":"), sort_keys=True)
    created_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO idempotency_records (idempotency_key, response_json, created_at) VALUES (?, ?, ?)",
            (idempotency_key, encoded, created_at),
        )
        if cursor.rowcount == 1:
            return response
        row = conn.execute(
            "SELECT response_json FROM idempotency_records WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
    return json.loads(row["response_json"])
