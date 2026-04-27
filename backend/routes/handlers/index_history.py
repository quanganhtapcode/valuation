from __future__ import annotations

import os
import sqlite3


def _normalize_index_token(index: str) -> str:
    return "".join(ch for ch in str(index or "").upper() if ch.isalnum())


def _index_aliases(index: str) -> list[str]:
    raw = str(index or "").strip()
    if not raw:
        return []

    norm = _normalize_index_token(raw)
    alias_map = {
        "VNINDEX": ["VNINDEX"],
        "VN30": ["VN30"],
        "HNXINDEX": ["HNXIndex", "HNXINDEX"],
        "HNXUPCOMINDEX": ["HNXUpcomIndex", "HNXUPCOMINDEX"],
        "UPCOM": ["HNXUpcomIndex", "HNXUPCOMINDEX"],
    }
    canonical = alias_map.get(norm)
    if canonical:
        return canonical

    # Unknown token: still try raw value as-is and upper-case variant.
    variants = [raw]
    upper = raw.upper()
    if upper != raw:
        variants.append(upper)
    return variants


def resolve_index_db_path(*, base_dir: str, index: str) -> str | None:
    # Preferred unified DB (all indices in one file)
    unified_candidates = [
        os.path.join(base_dir, "fetch_sqlite", "index_history.sqlite"),
        os.path.join(base_dir, "fetch_sqlite", "vci_market_indices.sqlite"),
    ]
    for unified in unified_candidates:
        if os.path.exists(unified):
            return unified

    fetch_dir = os.path.join(base_dir, "fetch_sqlite")
    for token in _index_aliases(index):
        db_path = os.path.join(fetch_dir, f"{token}.sqlite")
        if os.path.exists(db_path):
            return db_path

        db_path_alt = os.path.join(fetch_dir, f"{token}Index.sqlite")
        if os.path.exists(db_path_alt):
            return db_path_alt
    return None


def read_index_history(*, db_path: str, days: int, index: str | None = None) -> list[dict]:
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        index_symbol: str | None = None
        if index:
            aliases = _index_aliases(index)
            index_symbol = aliases[0] if aliases else str(index).strip()

        # Unified DB path: filter by symbol when table supports it.
        columns = [row[1] for row in cur.execute("PRAGMA table_info(market_index_history)").fetchall()]
        has_symbol = "symbol" in columns
        _COLS = "symbol, tradingDate, closeIndex, totalVolume, totalMatchVolume"
        if has_symbol and index_symbol:
            aliases = _index_aliases(index_symbol)
            placeholders = ",".join("?" * len(aliases))
            cur.execute(
                f"SELECT {_COLS} FROM market_index_history WHERE symbol IN ({placeholders}) "
                "ORDER BY tradingDate DESC LIMIT ?",
                (*aliases, days),
            )
        else:
            cur.execute(f"SELECT {_COLS} FROM market_index_history ORDER BY tradingDate DESC LIMIT ?", (days,))
        rows = cur.fetchall()
    return [dict(r) for r in rows]
