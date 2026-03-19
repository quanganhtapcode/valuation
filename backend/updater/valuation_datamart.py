from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone


def _to_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    arr = sorted(float(v) for v in values)
    n = len(arr)
    m = n // 2
    if n % 2 == 1:
        return arr[m]
    return (arr[m - 1] + arr[m]) / 2.0


def refresh_valuation_datamart(db_path: str) -> int:
    """Rebuild per-symbol valuation medians/counts for fast valuation API reads."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS valuation_datamart")
    cur.execute(
        """
        CREATE TABLE valuation_datamart (
            symbol TEXT PRIMARY KEY,
            industry TEXT,
            industry_screening_key TEXT,
            industry_screening_name TEXT,
            peer_count INTEGER DEFAULT 0,
            pe_median REAL DEFAULT 0,
            pb_median REAL DEFAULT 0,
            ps_median REAL DEFAULT 0,
            pe_count INTEGER DEFAULT 0,
            pb_count INTEGER DEFAULT 0,
            ps_count INTEGER DEFAULT 0,
            pe_source TEXT,
            pb_source TEXT,
            ps_source TEXT,
            refreshed_at TEXT
        )
        """
    )

    overview_rows = cur.execute(
        """
        SELECT symbol, industry, pe, pb
        FROM overview
        WHERE symbol IS NOT NULL
        """
    ).fetchall() or []

    if not overview_rows:
        cur.execute("CREATE INDEX IF NOT EXISTS idx_valuation_datamart_industry ON valuation_datamart(industry)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_valuation_datamart_screening_key ON valuation_datamart(industry_screening_key)")
        conn.commit()
        conn.close()
        return 0

    by_industry: dict[str, list[dict]] = {}
    for row in overview_rows:
        industry = str(row["industry"] or "Unknown").strip() or "Unknown"
        item = {
            "symbol": str(row["symbol"]).upper(),
            "industry": industry,
            "pe": _to_float(row["pe"]),
            "pb": _to_float(row["pb"]),
        }
        by_industry.setdefault(industry, []).append(item)

    ps_rows = cur.execute(
        """
        WITH latest AS (
            SELECT symbol, ps,
                   ROW_NUMBER() OVER (
                       PARTITION BY symbol
                       ORDER BY year DESC,
                                CASE WHEN quarter IS NULL THEN -1 ELSE quarter END DESC
                   ) AS rn
            FROM ratio_wide
            WHERE ps IS NOT NULL
        )
        SELECT symbol, ps
        FROM latest
        WHERE rn = 1
        """
    ).fetchall() or []
    ps_map = {str(row["symbol"]).upper(): _to_float(row["ps"]) for row in ps_rows if row["symbol"]}

    screening_meta: dict[str, dict] = {}
    screening_groups: dict[str, list[dict]] = {}
    try:
        from backend.db_path import resolve_vci_screening_db_path

        screening_db_path = resolve_vci_screening_db_path()
        if screening_db_path and os.path.exists(screening_db_path):
            sconn = sqlite3.connect(screening_db_path)
            sconn.row_factory = sqlite3.Row
            scur = sconn.cursor()
            scur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='screening_data'")
            has_table = scur.fetchone() is not None
            if has_table:
                srows = scur.execute(
                    """
                    SELECT ticker, icbCodeLv2, viSector, enSector, ttmPe, ttmPb
                    FROM screening_data
                    WHERE ticker IS NOT NULL
                    """
                ).fetchall() or []
                for row in srows:
                    symbol = str(row["ticker"]).upper().strip()
                    if not symbol:
                        continue
                    key = str(row["icbCodeLv2"]) if row["icbCodeLv2"] is not None else ""
                    name = str(row["viSector"] or row["enSector"] or "").strip()
                    screening_meta[symbol] = {"key": key, "name": name}
                    screening_groups.setdefault(key, []).append(
                        {
                            "symbol": symbol,
                            "pe": _to_float(row["ttmPe"]),
                            "pb": _to_float(row["ttmPb"]),
                        }
                    )
            sconn.close()
    except Exception:
        pass

    now_iso = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    inserts: list[tuple] = []

    for row in overview_rows:
        symbol = str(row["symbol"]).upper().strip()
        if not symbol:
            continue

        industry = str(row["industry"] or "Unknown").strip() or "Unknown"
        industry_group = [p for p in by_industry.get(industry, []) if p.get("symbol") != symbol]

        pe_over = [p["pe"] for p in industry_group if 0 < _to_float(p["pe"]) <= 80]
        pb_over = [p["pb"] for p in industry_group if 0 < _to_float(p["pb"]) <= 20]
        ps_vals = [
            _to_float(ps_map.get(str(p.get("symbol") or "").upper()))
            for p in industry_group
            if 0 < _to_float(ps_map.get(str(p.get("symbol") or "").upper())) <= 200
        ]

        pe_count = len(pe_over)
        pb_count = len(pb_over)
        ps_count = len(ps_vals)
        pe_median = _median(pe_over)
        pb_median = _median(pb_over)
        ps_median = _median(ps_vals)
        pe_source = "overview.industry"
        pb_source = "overview.industry"
        ps_source = "ratio_wide.latest_ps"

        meta = screening_meta.get(symbol, {})
        screening_key = str(meta.get("key") or "")
        screening_name = str(meta.get("name") or "")

        if screening_key:
            screening_group = [
                p for p in screening_groups.get(screening_key, []) if str(p.get("symbol") or "") != symbol
            ]
            pe_scr = [p["pe"] for p in screening_group if 0 < _to_float(p["pe"]) <= 80]
            pb_scr = [p["pb"] for p in screening_group if 0 < _to_float(p["pb"]) <= 20]

            if pe_scr:
                pe_median = _median(pe_scr)
                pe_count = len(pe_scr)
                pe_source = "vci_screening.icbCodeLv2"
            if pb_scr:
                pb_median = _median(pb_scr)
                pb_count = len(pb_scr)
                pb_source = "vci_screening.icbCodeLv2"

        inserts.append(
            (
                symbol,
                industry,
                screening_key,
                screening_name,
                int(len(industry_group)),
                float(pe_median or 0.0),
                float(pb_median or 0.0),
                float(ps_median or 0.0),
                int(pe_count),
                int(pb_count),
                int(ps_count),
                pe_source,
                pb_source,
                ps_source,
                now_iso,
            )
        )

    cur.executemany(
        """
        INSERT OR REPLACE INTO valuation_datamart (
            symbol,
            industry,
            industry_screening_key,
            industry_screening_name,
            peer_count,
            pe_median,
            pb_median,
            ps_median,
            pe_count,
            pb_count,
            ps_count,
            pe_source,
            pb_source,
            ps_source,
            refreshed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        inserts,
    )

    cur.execute("CREATE INDEX IF NOT EXISTS idx_valuation_datamart_industry ON valuation_datamart(industry)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_valuation_datamart_screening_key ON valuation_datamart(industry_screening_key)")

    conn.commit()
    conn.close()
    return len(inserts)
