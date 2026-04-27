"""Batch valuation updater.

Computes intrinsic value for every stock that has sufficient financial data
and caches the results in fetch_sqlite/valuation_cache.sqlite.

Run after the daily pipeline:
    python -m backend.updater.batch_valuations
"""
from __future__ import annotations

import logging
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

_CACHE_DB = Path(__file__).resolve().parents[2] / "fetch_sqlite" / "valuation_cache.sqlite"

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS valuations (
    symbol        TEXT PRIMARY KEY,
    intrinsic_value REAL,
    upside_pct    REAL,
    quality_score REAL,
    quality_grade TEXT,
    computed_at   TEXT
)
"""


def _get_symbols() -> list[str]:
    """Return all symbols from vci_screening."""
    from backend.db_path import resolve_vci_screening_db_path
    with sqlite3.connect(resolve_vci_screening_db_path()) as conn:
        rows = conn.execute(
            "SELECT DISTINCT ticker FROM screening_data ORDER BY ticker"
        ).fetchall()
    return [r[0] for r in rows if r[0]]


def _ensure_cache_db() -> str:
    _CACHE_DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(_CACHE_DB)) as conn:
        conn.execute(_CREATE_TABLE)
        conn.commit()
    return str(_CACHE_DB)


def run_batch_valuations(
    *,
    max_symbols: int | None = None,
    log_every: int = 100,
) -> dict:
    """Compute valuations for all eligible symbols and store them in the cache DB.

    Returns a summary dict with keys: computed, skipped, errors, total.
    """
    from backend.services.valuation_service import calculate_valuation

    cache_path = _ensure_cache_db()

    symbols = _get_symbols()
    if max_symbols:
        symbols = symbols[:max_symbols]

    results = {"computed": 0, "skipped": 0, "errors": 0, "total": len(symbols)}
    rows_to_upsert: list[tuple] = []

    for i, symbol in enumerate(symbols, 1):
        try:
            val = calculate_valuation(symbol, {})
            if not val.get("success"):
                results["skipped"] += 1
                continue

            intrinsic = (val.get("valuations") or {}).get("weighted_average")
            current_price = (val.get("inputs") or {}).get("current_price")
            quality = val.get("quality") or {}

            if intrinsic is None or not current_price or current_price <= 0:
                results["skipped"] += 1
                continue

            upside_pct = ((intrinsic - current_price) / current_price) * 100.0

            rows_to_upsert.append(
                (
                    symbol.upper(),
                    float(intrinsic),
                    float(upside_pct),
                    float(quality.get("score") or 0),
                    str(quality.get("grade") or ""),
                    datetime.utcnow().isoformat(),
                )
            )
            results["computed"] += 1

        except Exception as exc:
            logger.warning("Valuation failed for %s: %s", symbol, exc)
            results["errors"] += 1

        if i % log_every == 0:
            logger.info(
                "[%d/%d] batch_valuations: computed=%d skipped=%d errors=%d",
                i,
                len(symbols),
                results["computed"],
                results["skipped"],
                results["errors"],
            )

    # Bulk upsert
    if rows_to_upsert:
        with sqlite3.connect(cache_path) as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO valuations
                    (symbol, intrinsic_value, upside_pct, quality_score, quality_grade, computed_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                rows_to_upsert,
            )
            conn.commit()

    logger.info(
        "batch_valuations done: computed=%d skipped=%d errors=%d total=%d",
        results["computed"],
        results["skipped"],
        results["errors"],
        results["total"],
    )
    return results


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    summary = run_batch_valuations()
    print(summary)
