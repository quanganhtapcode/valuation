from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
from typing import Any, Optional


def _project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def default_standouts_db_path() -> str:
    root = _project_root()
    env_path = os.getenv("VCI_STANDOUTS_DB_PATH", "").strip()
    candidates = []
    if env_path:
        candidates.append(env_path)

    candidates.extend(
        [
            os.path.join(root, "fetch_sqlite", "vci_ai_standouts.sqlite"),
            "/var/www/valuation/fetch_sqlite/vci_ai_standouts.sqlite",
            "/var/www/store/fetch_sqlite/vci_ai_standouts.sqlite",
        ]
    )

    for path in candidates:
        if path and os.path.exists(path):
            return path

    return os.path.join(root, "fetch_sqlite", "vci_ai_standouts.sqlite")


def _connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def get_snapshot_row(db_path: str, key: str = "vci_ai_standouts") -> Optional[sqlite3.Row]:
    if not db_path or not os.path.exists(db_path):
        return None
    try:
        with _connect(db_path) as conn:
            return conn.execute(
                "SELECT raw_json, fetched_at_utc FROM standouts_snapshot WHERE key = ?",
                (key,),
            ).fetchone()
    except Exception:
        return None


def is_fresh(db_path: str, max_age_seconds: int = 3600) -> bool:
    row = get_snapshot_row(db_path)
    if not row:
        return False
    fetched = row["fetched_at_utc"] if isinstance(row, sqlite3.Row) else row[1]
    if not fetched:
        return False
    try:
        ts = dt.datetime.fromisoformat(str(fetched).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=dt.timezone.utc)
        age = dt.datetime.now(tz=dt.timezone.utc) - ts
        return age.total_seconds() <= max_age_seconds
    except Exception:
        return False


def read_ticker_info(db_path: str) -> list[dict[str, Any]]:
    row = get_snapshot_row(db_path)
    if not row:
        return []
    raw = row["raw_json"] if isinstance(row, sqlite3.Row) else row[0]
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except Exception:
        return []
    return list((payload or {}).get("ticker_info", []) or [])
