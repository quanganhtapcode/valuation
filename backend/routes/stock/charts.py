from __future__ import annotations

import logging
import os
import sqlite3

import pandas as pd
from flask import Blueprint, jsonify, request
from vnstock import Vnstock

from backend.extensions import get_provider
from backend.utils import validate_stock_symbol
from .cache import cache_get, cache_set


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/historical-chart-data/<symbol>")
    def api_historical_chart_data(symbol):
        """
        Historical financial ratios for a stock.

        Returns an array of period objects (oldest → newest), e.g.:
          {
            "success": true,
            "symbol": "MBB",
            "period": "quarter",
            "count": 20,
            "data": [
              { "period": "Q1 '20", "roe": 14.2, "roa": 1.8, "pe": 8.5, "pb": 1.3,
                "currentRatio": null, "quickRatio": null, "cashRatio": null,
                "nim": 4.1, "netMargin": 28.4 },
              ...
            ]
          }
        """
        try:
            is_valid, result = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"error": result}), 400
            symbol = result

            period = request.args.get("period", "quarter")
            cache_key = f"hist_chart_{symbol}_{period}"
            cached = cache_get(cache_key)
            if cached:
                logger.info(f"Cache HIT for historical-chart-data {symbol} {period}")
                return jsonify(cached)

            stock = Vnstock().stock(symbol=symbol, source="VCI")
            df = stock.finance.ratio(period=period, lang="en", dropna=True)
            if df is None or df.empty:
                return jsonify({"success": False, "message": "No data"}), 404

            # ── locate year / quarter columns ─────────────────────────────────
            year_col = None
            period_col = None
            for col in df.columns:
                s = str(col)
                if "yearReport" in s:
                    year_col = col
                if "lengthReport" in s:
                    period_col = col
            if not year_col and period == "year" and "year" in df.columns:
                year_col = "year"

            if year_col:
                sort_keys = [year_col, period_col] if period_col else [year_col]
                df = df.sort_values(sort_keys, ascending=True)

            # ── known tuple keys from VCI ─────────────────────────────────────
            KEY_ROE        = ("Chỉ tiêu khả năng sinh lợi", "ROE (%)")
            KEY_ROA        = ("Chỉ tiêu khả năng sinh lợi", "ROA (%)")
            KEY_NET_MARGIN = ("Chỉ tiêu khả năng sinh lợi", "Net Profit Margin (%)")
            KEY_NIM        = ("Chỉ tiêu khả năng sinh lợi", "NIM (%)")
            KEY_PE         = ("Chỉ tiêu định giá", "P/E")
            KEY_PB         = ("Chỉ tiêu định giá", "P/B")
            KEY_CURRENT    = ("Chỉ tiêu thanh khoản", "Current Ratio")
            KEY_QUICK      = ("Chỉ tiêu thanh khoản", "Quick Ratio")
            KEY_CASH       = ("Chỉ tiêu thanh khoản", "Cash Ratio")

            def _val(row, key) -> float | None:
                """Extract a float from a row, returning None if missing/NaN."""
                raw = row.get(key)
                if raw is None or (isinstance(raw, float) and pd.isna(raw)):
                    return None
                try:
                    return float(raw)
                except Exception:
                    return None

            def _safe(row, key) -> float | None:
                """Try exact key, fall back to substring match on column name."""
                v = _val(row, key)
                if v is not None:
                    return v
                needle = str(key[-1]) if isinstance(key, tuple) else str(key)
                for col in row.index:
                    if needle in str(col):
                        v = _val(row, col)
                        if v is not None:
                            return v
                return None

            def _pct(row, key) -> float | None:
                """Get a percentage value; multiply by 100 if stored as a fraction."""
                v = _safe(row, key)
                if v is not None and abs(v) < 1:
                    v = round(v * 100, 4)
                return v

            # ── build records ─────────────────────────────────────────────────
            records: list[dict] = []
            nim_labels: list[str] = []       # for DB NIM fallback alignment

            for _, row in df.iterrows():
                y = row.get(year_col)
                q = row.get(period_col) if period_col else None
                label = str(y)
                if period == "quarter" and q:
                    label = f"Q{int(q)} '{str(y)[-2:]}"
                nim_labels.append(label)

                records.append({
                    "period":       label,
                    "roe":          _pct(row, KEY_ROE),
                    "roa":          _pct(row, KEY_ROA),
                    "pe":           _safe(row, KEY_PE),
                    "pb":           _safe(row, KEY_PB),
                    "currentRatio": _safe(row, KEY_CURRENT),
                    "quickRatio":   _safe(row, KEY_QUICK),
                    "cashRatio":    _safe(row, KEY_CASH),
                    "nim":          _pct(row, KEY_NIM),
                    "netMargin":    _pct(row, KEY_NET_MARGIN),
                })

            # ── NIM SQLite fallback (banks) ────────────────────────────────────
            live_nim_count = sum(1 for r in records if r["nim"] not in (None, 0))
            try:
                provider = get_provider()
                db_path = getattr(provider, "db_path", None)
                if db_path and os.path.exists(db_path):
                    with sqlite3.connect(db_path) as conn:
                        conn.row_factory = sqlite3.Row
                        cur = conn.cursor()
                        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ratio_wide'")
                        if cur.fetchone():
                            if period == "quarter":
                                cur.execute(
                                    """
                                    SELECT year, quarter, nim, cof
                                    FROM ratio_wide
                                    WHERE symbol = ? AND period_type = 'quarter' AND nim IS NOT NULL
                                    ORDER BY year ASC, quarter ASC
                                    """,
                                    (symbol,),
                                )
                                rows = cur.fetchall()
                                if rows:
                                    nim_map = {}
                                    for r in rows:
                                        lbl = f"Q{int(r['quarter'])} '{str(r['year'])[-2:]}"
                                        nim_val = float(r["nim"])
                                        if r["cof"] is not None and 0 < nim_val < 2:
                                            nim_val *= 4
                                        nim_map[lbl] = round(nim_val, 2)
                                    if len(nim_map) > live_nim_count:
                                        for rec in records:
                                            if rec["period"] in nim_map:
                                                rec["nim"] = nim_map[rec["period"]]
                            else:
                                cur.execute(
                                    """
                                    SELECT year,
                                           AVG(CASE WHEN cof IS NOT NULL AND nim > 0 AND nim < 2
                                                    THEN nim * 4 ELSE nim END) AS nim_year
                                    FROM ratio_wide
                                    WHERE symbol = ? AND period_type = 'quarter' AND nim IS NOT NULL
                                    GROUP BY year ORDER BY year ASC
                                    """,
                                    (symbol,),
                                )
                                rows = cur.fetchall()
                                if rows:
                                    nim_map = {str(int(r["year"])): round(float(r["nim_year"]), 2)
                                               for r in rows if r["nim_year"] is not None}
                                    if len(nim_map) > live_nim_count:
                                        for rec in records:
                                            yr = rec["period"][:4] if rec["period"][:4].isdigit() else None
                                            if yr and yr in nim_map:
                                                rec["nim"] = nim_map[yr]
            except Exception as db_exc:
                logger.warning(f"NIM DB fallback failed for {symbol}: {db_exc}")

            result = {
                "success": True,
                "symbol":  symbol,
                "period":  period,
                "count":   len(records),
                "data":    records,
            }
            cache_set(cache_key, result)
            return jsonify(result)

        except Exception as exc:
            logger.error(f"API /historical-chart-data error {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
