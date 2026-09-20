"""Read-only SQLite connections with deterministic cleanup."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path


def open_readonly(db_path: str | Path, *, timeout: float = 3) -> sqlite3.Connection:
    conn = sqlite3.connect(Path(db_path).resolve().as_uri() + '?mode=ro', uri=True, timeout=timeout)
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        conn.close()
        raise


@contextmanager
def read_connection(db_path: str | Path, *, timeout: float = 3):
    conn = open_readonly(db_path, timeout=timeout)
    try:
        yield conn
    finally:
        conn.close()


def row_dict(row: sqlite3.Row) -> dict:
    """Iterate values instead of looking up every name in a wide statement."""
    return dict(zip(row.keys(), row))
