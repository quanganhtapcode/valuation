"""Financial statements and field labels for stock reports."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from pathlib import Path
from flask import Blueprint, jsonify, request
from backend.db_path import resolve_vci_financial_statement_db_path, resolve_vci_stats_financial_db_path
from backend.utils import validate_stock_symbol
from .cache import _cache_get, _cache_set

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]

_FALLBACK_METRIC_LABELS: dict[str, str] = {
    "bsb126": "Bảo lãnh (Bảo lãnh vay vốn + Bảo lãnh khác)",
    "bsb157": "Bảo lãnh (Bảo lãnh vay vốn + Bảo lãnh khác)",
    "bsb179": "Cam kết giao dịch hối đoái (Mua + Bán ngoại tệ)",
    "bsb132": "Chỉ tiêu ngoại bảng (VCI chưa công bố title)",
    "cfb46": "CFB46 (VCI chưa công bố title)",
    "cfb47": "CFB47 (VCI chưa công bố title)",
}

def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/financial-report/<symbol>")
    @stock_bp.route("/stock/<symbol>/financial-report")
    def api_financial_report(symbol: str):
        """
        Return financial statements for a symbol.
        Query params:
          type   = income | balance | cashflow | note | ratio  (default: income)
          period = quarter | year                       (default: quarter)
          limit  = number of periods                    (default: 8)
        """
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": clean_symbol}), 400

        report_type = request.args.get("type", "income").lower()
        period = request.args.get("period", "quarter").lower()
        limit = min(60, max(1, int(request.args.get("limit", 8))))

        cache_key = f"fin_report_{clean_symbol}_{report_type}_{period}_{limit}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return jsonify(cached)

        table_map = {
            "income": "income_statement",
            "balance": "balance_sheet",
            "cashflow": "cash_flow_statement",
            "ratio": "financial_ratios",
            "note": None,
        }
        table = table_map.get(report_type)
        if report_type not in table_map:
            return jsonify({"error": f"Unknown report type '{report_type}'"}), 400

        # Prefer VCI financial-statement SQLite for statement tabs.
        # Returns rows keyed by VCI field codes (e.g. isa1/bsa1/cfa1).
        _WIDE_TABLE_MAP = {
            "income": "income_statement",
            "balance": "balance_sheet",
            "cashflow": "cash_flow",
            "note": "note",
        }
        _LONG_SECTION_MAP = {
            "income": "INCOME_STATEMENT",
            "balance": "BALANCE_SHEET",
            "cashflow": "CASH_FLOW",
            "note": "NOTE",
        }
        _WIDE_EXCLUDE_COLS = frozenset({
            "ticker", "period_kind", "length_report",
            "public_date", "create_date", "update_date", "fetched_at",
        })
        if report_type in ("income", "balance", "cashflow", "note"):
            fs_db_path = resolve_vci_financial_statement_db_path()
            logger.info(f"Note report debug: report_type={report_type}, fs_db_path={fs_db_path}, exists={os.path.exists(fs_db_path) if fs_db_path else False}")
            if fs_db_path and os.path.exists(fs_db_path):
                try:
                    conn = sqlite3.connect(fs_db_path)
                    conn.row_factory = sqlite3.Row
                    period_kind = "YEAR" if period == "year" else "QUARTER"

                    # Detect schema: wide format has per-section tables; long format has statement_values
                    wide_table = _WIDE_TABLE_MAP.get(report_type)
                    has_wide = bool(wide_table and conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                        (wide_table,),
                    ).fetchone())

                    if has_wide:
                        rows = conn.execute(
                            f"""
                            SELECT * FROM {wide_table}
                            WHERE ticker = ? AND period_kind = ?
                            ORDER BY year_report DESC, quarter_report DESC
                            LIMIT ?
                            """,
                            (clean_symbol, period_kind, limit),
                        ).fetchall()
                        logger.info(f"Note query: wide_table={wide_table}, ticker={clean_symbol}, period_kind={period_kind}, rows_count={len(rows)}")
                        conn.close()
                        if rows:
                            data: list[dict] = []
                            for r in rows:
                                rd = {k: r[k] for k in r.keys()}
                                out: dict = {
                                    "year": rd.get("year_report"),
                                    "quarter": rd.get("quarter_report", 0),
                                }
                                for k, v in rd.items():
                                    if k not in _WIDE_EXCLUDE_COLS and v is not None:
                                        out[k] = v
                                data.append(out)
                            _cache_set(cache_key, data)
                            return jsonify(data)
                        _cache_set(cache_key, [])
                        return jsonify([])

                    # Long format fallback (statement_periods + statement_values)
                    section = _LONG_SECTION_MAP[report_type]
                    period_rows = conn.execute(
                        """
                        SELECT year_report, quarter_report
                        FROM statement_periods
                        WHERE ticker = ? AND section = ? AND period_kind = ?
                        ORDER BY year_report DESC, quarter_report DESC
                        LIMIT ?
                        """,
                        (clean_symbol, section, period_kind, limit),
                    ).fetchall()
                    if period_rows:
                        data = []
                        for prow in period_rows:
                            y = int(prow["year_report"])
                            q = int(prow["quarter_report"] or 0)
                            values = conn.execute(
                                """
                                SELECT field, value
                                FROM statement_values
                                WHERE ticker = ? AND section = ? AND period_kind = ?
                                  AND year_report = ? AND quarter_report = ?
                                ORDER BY field
                                """,
                                (clean_symbol, section, period_kind, y, q),
                            ).fetchall()
                            row: dict = {"year": y, "quarter": q}
                            for v in values:
                                row[str(v["field"])] = v["value"]
                            data.append(row)
                        conn.close()
                        _cache_set(cache_key, data)
                        return jsonify(data)
                    conn.close()
                except Exception as exc:
                    logger.warning(f"VCI FS DB read failed for {clean_symbol}: {exc}")

        if report_type == "note":
            logger.info(f"Note report for {clean_symbol}: returning empty (VCI FS DB not available or no data)")
            return jsonify([])

        # ── Ratio tab: read from vci_stats_financial_history ──────────────── #
        if report_type == "ratio":
            sf_path = resolve_vci_stats_financial_db_path()
            if sf_path and os.path.exists(sf_path):
                try:
                    conn = sqlite3.connect(sf_path, timeout=5)
                    conn.row_factory = sqlite3.Row
                    # quarter_report=5 means annual in VCI convention
                    if period == "year":
                        qfilter = "quarter_report = 5"
                    else:
                        qfilter = "quarter_report IN (1,2,3,4)"
                    rows = conn.execute(
                        f"""
                        SELECT year_report, quarter_report, period_date,
                               pe, pb, ps, price_to_cash_flow, ev_to_ebitda,
                               roe, roa, roic,
                               gross_margin, ebit_margin, pre_tax_margin, after_tax_margin,
                               current_ratio, quick_ratio, cash_ratio,
                               debt_to_equity, financial_leverage, asset_turnover,
                               dividend_yield, market_cap, shares,
                               day_sale_outstanding, days_inventory_outstanding, days_payable_outstanding,
                               net_interest_margin, cir, car, casa_ratio, npl, ldr,
                               loans_growth, deposit_growth
                        FROM stats_financial_history
                        WHERE ticker = ? AND {qfilter}
                        ORDER BY year_report DESC, quarter_report DESC
                        LIMIT ?
                        """,
                        (clean_symbol, limit),
                    ).fetchall()
                    conn.close()

                    if rows:
                        data = []
                        for r in rows:
                            row_data = {
                                "year": r["year_report"],
                                "quarter": r["quarter_report"] if period != "year" else 0,
                                "period_date": r["period_date"],
                                # Valuation multiples
                                "pe": r["pe"],
                                "pb": r["pb"],
                                "ps": r["ps"],
                                "price_to_cash_flow": r["price_to_cash_flow"],
                                "ev_to_ebitda": r["ev_to_ebitda"],
                                # Profitability
                                "roe": r["roe"],
                                "roa": r["roa"],
                                "roic": r["roic"],
                                "gross_profit_margin": r["gross_margin"],
                                "gross_margin": r["gross_margin"],
                                "ebit_margin": r["ebit_margin"],
                                "pre_tax_margin": r["pre_tax_margin"],
                                "net_profit_margin": r["after_tax_margin"],
                                "after_tax_margin": r["after_tax_margin"],
                                # Liquidity / leverage
                                "current_ratio": r["current_ratio"],
                                "quick_ratio": r["quick_ratio"],
                                "cash_ratio": r["cash_ratio"],
                                "debt_to_equity": r["debt_to_equity"],
                                "financial_leverage": r["financial_leverage"],
                                "asset_turnover": r["asset_turnover"],
                                # Market
                                "dividend_yield": r["dividend_yield"],
                                "market_cap": r["market_cap"],
                                "shares": r["shares"],
                                # Efficiency
                                "day_sale_outstanding": r["day_sale_outstanding"],
                                "days_inventory_outstanding": r["days_inventory_outstanding"],
                                "days_payable_outstanding": r["days_payable_outstanding"],
                                # Banking-specific
                                "net_interest_margin": r["net_interest_margin"],
                                "cir": r["cir"],
                                "car": r["car"],
                                "casa_ratio": r["casa_ratio"],
                                "npl": r["npl"],
                                "ldr": r["ldr"],
                                "loans_growth": r["loans_growth"],
                                "deposit_growth": r["deposit_growth"],
                            }
                            data.append(row_data)
                        _cache_set(cache_key, data)
                        return jsonify(data)
                except Exception as exc:
                    logger.warning(f"vci_stats_financial ratio query failed for {clean_symbol}: {exc}")
            return jsonify([])

        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row

            # Check table exists
            exists = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if not exists:
                conn.close()
                return jsonify([])

            if period == "year":
                period_filter = "(quarter IS NULL OR quarter = 0)"
            else:
                period_filter = "quarter IN (1,2,3,4)"

            rows = conn.execute(
                f"""
                SELECT * FROM {table}
                WHERE symbol = ? AND {period_filter}
                ORDER BY year DESC, quarter DESC
                LIMIT ?
                """,
                (clean_symbol, limit),
            ).fetchall()
            conn.close()

            data = [dict(r) for r in rows]
            _cache_set(cache_key, data)
            return jsonify(data)
        except Exception as exc:
            logger.error(f"GET /financial-report/{clean_symbol} error: {exc}")
            return jsonify({"error": str(exc)}), 500

    @stock_bp.route("/financial-report-metrics/<symbol>")
    @stock_bp.route("/stock/<symbol>/financial-report-metrics")
    def api_financial_report_metrics(symbol: str):
        """Return mapping for VCI field codes (isa1/bsa1/cfa1 -> label)."""
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": clean_symbol}), 400

        report_type = request.args.get("type", "income").lower()
        section_map = {
            "income": "INCOME_STATEMENT",
            "balance": "BALANCE_SHEET",
            "cashflow": "CASH_FLOW",
            "note": "NOTE",
        }
        section = section_map.get(report_type)
        if not section:
            return jsonify({"error": f"Unknown report type '{report_type}'"}), 400

        cache_key = f"fin_report_metrics_{report_type}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return jsonify(cached)

        fs_db_path = resolve_vci_financial_statement_db_path()
        if not fs_db_path or not os.path.exists(fs_db_path):
            return jsonify({"data": [], "field_map": {}})

        try:
            conn = sqlite3.connect(fs_db_path)
            conn.row_factory = sqlite3.Row

            # Check if wide-format DB (has no statement_metrics table — use JSON instead)
            has_metrics_table = bool(conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='statement_metrics'"
            ).fetchone())
            conn.close()

            if not has_metrics_table:
                # Wide-format DB: read from bundled JSON file
                json_path = PROJECT_ROOT / "config" / "vci_field_codes.json"
                if not json_path.exists():
                    return jsonify({"data": [], "field_map": {}})
                with open(json_path, encoding="utf-8") as f:
                    metrics_json: dict = json.load(f)
                items = metrics_json.get(section, [])
                data: list[dict] = []
                field_map: dict[str, str] = {}
                field_map_en: dict[str, str] = {}
                for m in items:
                    field = str(m.get("field", "")).strip().lower()
                    if not field:
                        continue
                    title_vi = str(m.get("titleVi", "") or "").strip()
                    title_en = str(m.get("titleEn", "") or "").strip()
                    name = str(m.get("name", "") or "").strip()
                    label_vi = title_vi or name or field.upper()
                    label_en = title_en or name or field.upper()
                    parent_raw = m.get("parent")
                    parent = str(parent_raw).strip().lower() if parent_raw else None
                    level = m.get("level")
                    data.append({
                        "field": field,
                        "label": label_vi,
                        "label_en": label_en,
                        "parent": parent,
                        "level": level,
                    })
                    field_map[field] = label_vi
                    field_map_en[field] = label_en
                result = {"data": data, "field_map": field_map, "field_map_en": field_map_en}
                _cache_set(cache_key, result)
                return jsonify(result)

            # Long-format DB: read from statement_metrics table
            conn = sqlite3.connect(fs_db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT field, title_vi, title_en, name, parent, level
                FROM statement_metrics
                WHERE section = ?
                ORDER BY field
                """,
                (section,),
            ).fetchall()
            conn.close()

            data = []
            field_map = {}
            field_map_en = {}
            for r in rows:
                field = str(r["field"] or "").strip().lower()
                if not field:
                    continue
                title_vi = str(r["title_vi"] or "").strip()
                title_en = str(r["title_en"] or "").strip()
                name = str(r["name"] or "").strip()
                label_vi = title_vi or name or field.upper()
                label_en = title_en or name or field.upper()
                if label_vi.upper() == field.upper():
                    label_vi = _FALLBACK_METRIC_LABELS.get(field, label_vi)
                if label_en.upper() == field.upper():
                    label_en = _FALLBACK_METRIC_LABELS.get(field, label_en)
                parent = str(r["parent"] or "").strip().lower() or None
                level = int(r["level"] or 0) if r["level"] is not None else None
                data.append({"field": field, "label": label_vi, "label_en": label_en, "parent": parent, "level": level})
                field_map[field] = label_vi
                field_map_en[field] = label_en

            result = {"data": data, "field_map": field_map, "field_map_en": field_map_en}
            _cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error(f"GET /financial-report-metrics/{clean_symbol} error: {exc}")
            return jsonify({"error": str(exc)}), 500
