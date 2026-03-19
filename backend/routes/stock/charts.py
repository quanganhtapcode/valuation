from __future__ import annotations

import json
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
        """Get historical chart data for Financials Tab charts (ROE, ROA, PE, PB, etc.)."""
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

            year_col = None
            period_col = None
            for col in df.columns:
                if isinstance(col, tuple):
                    if "yearReport" in str(col):
                        year_col = col
                    if "lengthReport" in str(col):
                        period_col = col
                else:
                    if "yearReport" in str(col):
                        year_col = col
                    if "lengthReport" in str(col):
                        period_col = col

            if not year_col and period == "year" and "year" in df.columns:
                year_col = "year"

            if year_col:
                if period_col:
                    df = df.sort_values([year_col, period_col], ascending=[True, True])
                else:
                    df = df.sort_values([year_col], ascending=[True])

            years = []
            roe_data = []
            roa_data = []
            pe_ratio_data = []
            pb_ratio_data = []
            current_ratio_data = []
            quick_ratio_data = []
            cash_ratio_data = []
            nim_data = []

            def get_val(row, key_tuple):
                val = row.get(key_tuple)
                if pd.isna(val):
                    return None
                try:
                    return float(val)
                except Exception:
                    return None

            key_roe = ("Chỉ tiêu khả năng sinh lợi", "ROE (%)")
            key_roa = ("Chỉ tiêu khả năng sinh lợi", "ROA (%)")
            key_pe = ("Chỉ tiêu định giá", "P/E")
            key_pb = ("Chỉ tiêu định giá", "P/B")
            key_current = ("Chỉ tiêu thanh khoản", "Current Ratio")
            key_quick = ("Chỉ tiêu thanh khoản", "Quick Ratio")
            key_cash = ("Chỉ tiêu thanh khoản", "Cash Ratio")
            key_nim = ("Chỉ tiêu khả năng sinh lợi", "NIM (%)")

            for _, row in df.iterrows():
                y = row.get(year_col)
                p = row.get(period_col) if period_col else None
                label = str(y)
                if period == "quarter" and p:
                    label = f"Q{int(p)} '{str(y)[-2:]}"
                years.append(label)

                def safe_get(k):
                    if k in row:
                        return get_val(row, k)
                    k_str = str(k[-1]) if isinstance(k, tuple) else str(k)
                    for col_key in row.index:
                        if k_str in str(col_key):
                            return get_val(row, col_key)
                    return None

                roe = safe_get(key_roe)
                if roe is not None and abs(roe) < 1:
                    roe *= 100
                roe_data.append(roe)

                roa = safe_get(key_roa)
                if roa is not None and abs(roa) < 1:
                    roa *= 100
                roa_data.append(roa)

                pe_ratio_data.append(safe_get(key_pe))
                pb_ratio_data.append(safe_get(key_pb))
                current_ratio_data.append(safe_get(key_current))
                quick_ratio_data.append(safe_get(key_quick))
                cash_ratio_data.append(safe_get(key_cash))

                nim = safe_get(key_nim)
                if nim is not None and abs(nim) < 1:
                    nim *= 100
                nim_data.append(nim)

            # DB fallback for NIM
            has_nim_values = any(v is not None and pd.notna(v) and float(v) != 0 for v in nim_data)
            live_nim_non_zero_count = sum(1 for v in nim_data if v is not None and pd.notna(v) and float(v) != 0)
            if period in ("quarter", "year"):
                try:
                    provider = get_provider()
                    db_path = getattr(provider, "db_path", None)
                    if db_path and os.path.exists(db_path):
                        conn = sqlite3.connect(db_path)
                        conn.row_factory = sqlite3.Row
                        cursor = conn.cursor()
                        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ratio_wide'")
                        has_ratio_wide = cursor.fetchone() is not None
                        if has_ratio_wide:
                            if period == "quarter":
                                cursor.execute(
                                    """
                                    SELECT year, quarter, nim, cof
                                    FROM ratio_wide
                                    WHERE symbol = ?
                                      AND period_type = 'quarter'
                                      AND nim IS NOT NULL
                                    ORDER BY year ASC, quarter ASC
                                    """,
                                    (symbol,),
                                )
                                rows = cursor.fetchall()
                                if rows:
                                    nim_by_label = {}
                                    for r in rows:
                                        label = f"Q{int(r['quarter'])} '{str(r['year'])[-2:]}"
                                        nim_val = float(r["nim"])
                                        if r["cof"] is not None and 0 < nim_val < 2:
                                            nim_val = nim_val * 4
                                        nim_by_label[label] = round(nim_val, 2)
                                    db_nim_non_zero_count = len(nim_by_label)
                                    if (not has_nim_values) or (db_nim_non_zero_count > live_nim_non_zero_count):
                                        if years:
                                            nim_data = [nim_by_label.get(label, 0) for label in years]
                                        else:
                                            years = list(nim_by_label.keys())
                                            nim_data = [nim_by_label[label] for label in years]
                            else:
                                cursor.execute(
                                    """
                                    SELECT year, AVG(CASE
                                        WHEN cof IS NOT NULL AND nim > 0 AND nim < 2 THEN nim * 4
                                        ELSE nim
                                    END) AS nim_year
                                    FROM ratio_wide
                                    WHERE symbol = ?
                                      AND period_type = 'quarter'
                                      AND nim IS NOT NULL
                                    GROUP BY year
                                    ORDER BY year ASC
                                    """,
                                    (symbol,),
                                )
                                rows = cursor.fetchall()
                                if rows:
                                    nim_by_year = {str(int(r["year"])): round(float(r["nim_year"]), 2) for r in rows if r["nim_year"] is not None}
                                    db_nim_non_zero_count = len(nim_by_year)
                                    if (not has_nim_values) or (db_nim_non_zero_count > live_nim_non_zero_count):
                                        if years:
                                            nim_data = [nim_by_year.get(str(y), 0) for y in years]
                                        else:
                                            years = sorted(nim_by_year.keys())
                                            nim_data = [nim_by_year[y] for y in years]
                        conn.close()
                except Exception as db_exc:
                    logger.warning(f"NIM DB fallback failed for {symbol}: {db_exc}")

            result = {
                "success": True,
                "data": {
                    "years": years,
                    "roe_data": roe_data,
                    "roa_data": roa_data,
                    "pe_ratio_data": pe_ratio_data,
                    "pb_ratio_data": pb_ratio_data,
                    "current_ratio_data": current_ratio_data,
                    "quick_ratio_data": quick_ratio_data,
                    "cash_ratio_data": cash_ratio_data,
                    "nim_data": nim_data,
                },
            }
            cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error(f"API /historical-chart-data error {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
