from __future__ import annotations

import json
import os
import sqlite3
from typing import Any, Optional

from backend.db_path import resolve_vci_technical_db_path


def default_technical_db_path() -> str:
    return resolve_vci_technical_db_path()


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def query_technical_snapshot(db_path: str, symbol: str, timeframe: str) -> Optional[dict[str, Any]]:
    """Return one cached technical snapshot from SQLite, or None when unavailable."""
    if not db_path or not os.path.exists(db_path):
        return None

    clean_symbol = (symbol or "").strip().upper()
    clean_timeframe = (timeframe or "").strip().upper()
    if not clean_symbol or not clean_timeframe:
        return None

    try:
        with _connect(db_path) as conn:
            row = conn.execute(
                """
                SELECT raw_json, fetched_at_utc
                FROM technical_snapshots
                WHERE UPPER(ticker) = ? AND UPPER(timeframe) = ?
                LIMIT 1
                """,
                (clean_symbol, clean_timeframe),
            ).fetchone()
    except Exception:
        return None

    if not row:
        return None

    raw_json = row["raw_json"] if isinstance(row, sqlite3.Row) else row[0]
    fetched_at_utc = row["fetched_at_utc"] if isinstance(row, sqlite3.Row) else row[1]

    try:
        raw = json.loads(raw_json) if raw_json else {}
    except Exception:
        raw = {}

    if not isinstance(raw, dict):
        raw = {}

    payload = raw.get("data")
    if not isinstance(payload, dict):
        payload = raw

    return {
        "success": bool(raw.get("successful", raw.get("success", True))),
        "symbol": clean_symbol,
        "timeframe": clean_timeframe,
        "fetched_at_utc": fetched_at_utc,
        "serverDateTime": raw.get("serverDateTime"),
        "traceId": raw.get("traceId"),
        "status": raw.get("status"),
        "code": raw.get("code"),
        "msg": raw.get("msg"),
        "data": payload,
    }
