"""
Missing routes that frontend stockApi.ts expects but backend never exposed.

Endpoints added:
  GET  /api/companies                          – list all companies (paginated)
  GET  /api/companies/search?q=&limit=         – full-text search by ticker / name
  GET  /api/companies/industry/<industry>      – list stocks in an industry
  GET  /api/financial-report/<symbol>          – income / balance / cashflow / ratio
  GET  /api/financial-report-metrics/<symbol>  – field-code mapping for statements
  GET  /api/batch-overview?symbols=            – stock overview for multiple tickers
  GET  /api/db/stats                           – database statistics
  GET  /api/stock/<symbol>/freshness           – data-freshness for a symbol
  GET/POST /api/valuation/<symbol>/sensitivity – 9×9 DCF sensitivity matrix
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time as _time
from datetime import datetime

from flask import Blueprint, jsonify, request

from backend.db_path import (
    resolve_stocks_db_path,
    resolve_vci_financial_statement_db_path,
    resolve_vci_screening_db_path,
)
from backend.extensions import get_provider, get_stock_service, get_financial_service, get_valuation_service
from backend.utils import validate_stock_symbol

logger = logging.getLogger(__name__)

# Simple in-memory cache (reuse pattern from stock_routes)
_cache: dict = {}
_CACHE_TTL = 600  # 10 min


def _cache_get(key):
    entry = _cache.get(key)
    if entry and (_time.time() - entry[0]) < _CACHE_TTL:
        return entry[1]
    return None


def _cache_set(key, data):
    _cache[key] = (_time.time(), data)
    if len(_cache) > 300:
        cutoff = _time.time() - _CACHE_TTL
        for k in [k for k, (t, _) in list(_cache.items()) if t < cutoff]:
            _cache.pop(k, None)


def register(stock_bp: Blueprint) -> None:

    # ------------------------------------------------------------------ #
    # GET /api/companies                                                    #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/companies")
    def api_companies():
        """Return all companies, optionally filtered by exchange."""
        exchange = request.args.get("exchange", "").upper()
        page = max(1, int(request.args.get("page", 1)))
        limit = min(500, max(10, int(request.args.get("limit", 200))))

        cache_key = f"companies_{exchange}_{page}_{limit}"
        cached = _cache_get(cache_key)
        if cached:
            return jsonify(cached)

        db_path = resolve_stocks_db_path()
        screening_path = resolve_vci_screening_db_path()
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            conn.execute(f"ATTACH DATABASE '{screening_path}' AS scr")
            cur = conn.cursor()

            q = """
                SELECT s.ticker AS symbol, s.organ_name AS name,
                       COALESCE(sc.exchange, 'HOSE') AS exchange,
                       COALESCE(sc.enSector, co.icb_name3, '') AS industry
                FROM stocks s
                LEFT JOIN scr.screening_data sc ON sc.ticker = s.ticker
                LEFT JOIN company_overview co ON co.symbol = s.ticker
            """
            params: list = []
            if exchange:
                q += " WHERE COALESCE(sc.exchange, 'HOSE') = ?"
                params.append(exchange)
            q += " ORDER BY s.ticker LIMIT ? OFFSET ?"
            params += [limit, (page - 1) * limit]

            cur.execute(q, params)
            rows = cur.fetchall()
            conn.close()

            result = [dict(r) for r in rows]
            _cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error(f"GET /companies error: {exc}")
            return jsonify({"error": str(exc)}), 500

    # ------------------------------------------------------------------ #
    # GET /api/companies/search                                             #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/companies/search")
    def api_companies_search():
        """Search companies by ticker or name."""
        q = request.args.get("q", "").strip()
        limit = min(50, max(1, int(request.args.get("limit", 20))))
        if not q:
            return jsonify([])

        cache_key = f"co_search_{q.lower()}_{limit}"
        cached = _cache_get(cache_key)
        if cached:
            return jsonify(cached)

        try:
            stock_service = get_stock_service()
            results = stock_service.search_stocks(q, limit)
            _cache_set(cache_key, results)
            return jsonify(results)
        except Exception as exc:
            logger.error(f"GET /companies/search error: {exc}")
            return jsonify({"error": str(exc)}), 500

    # ------------------------------------------------------------------ #
    # GET /api/companies/industry/<industry>                                #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/companies/industry/<path:industry>")
    def api_companies_by_industry(industry: str):
        """Return stocks belonging to an industry (ICB level-3 or level-4)."""
        cache_key = f"co_industry_{industry.lower()}"
        cached = _cache_get(cache_key)
        if cached:
            return jsonify(cached)

        db_path = resolve_stocks_db_path()
        screening_path = resolve_vci_screening_db_path()
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            conn.execute(f"ATTACH DATABASE '{screening_path}' AS scr")
            cur = conn.cursor()

            cur.execute(
                """
                SELECT s.ticker AS symbol, s.organ_name AS name,
                       COALESCE(sc.exchange, 'HOSE') AS exchange,
                       sc.enSector AS industry
                FROM stocks s
                JOIN scr.screening_data sc ON sc.ticker = s.ticker
                WHERE sc.enSector = ?
                ORDER BY s.ticker
                """,
                (industry,),
            )
            rows = cur.fetchall()
            conn.close()

            result = [dict(r) for r in rows]
            _cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error(f"GET /companies/industry error: {exc}")
            return jsonify({"error": str(exc)}), 500

    # ------------------------------------------------------------------ #
    # GET /api/financial-report/<symbol>                                    #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/financial-report/<symbol>")
    def api_financial_report(symbol: str):
        """
        Return financial statements for a symbol.
        Query params:
          type   = income | balance | cashflow | ratio  (default: income)
          period = quarter | year                       (default: quarter)
          limit  = number of periods                    (default: 8)
        """
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": clean_symbol}), 400

        report_type = request.args.get("type", "income").lower()
        period = request.args.get("period", "quarter").lower()
        limit = min(20, max(1, int(request.args.get("limit", 8))))

        cache_key = f"fin_report_{clean_symbol}_{report_type}_{period}_{limit}"
        cached = _cache_get(cache_key)
        if cached:
            return jsonify(cached)

        db_path = resolve_stocks_db_path()
        if not db_path or not os.path.exists(db_path):
            return jsonify({"error": "Database not found"}), 503

        table_map = {
            "income": "income_statement",
            "balance": "balance_sheet",
            "cashflow": "cash_flow_statement",
            "ratio": "financial_ratios",
        }
        table = table_map.get(report_type)
        if not table:
            return jsonify({"error": f"Unknown report type '{report_type}'"}), 400

        # Prefer VCI financial-statement SQLite for statement tabs.
        # Returns rows keyed by VCI field codes (e.g. isa1/bsa1/cfa1).
        if report_type in ("income", "balance", "cashflow"):
            fs_db_path = resolve_vci_financial_statement_db_path()
            section_map = {
                "income": "INCOME_STATEMENT",
                "balance": "BALANCE_SHEET",
                "cashflow": "CASH_FLOW",
            }
            section = section_map[report_type]
            if fs_db_path and os.path.exists(fs_db_path):
                try:
                    conn = sqlite3.connect(fs_db_path)
                    conn.row_factory = sqlite3.Row
                    period_kind = "YEAR" if period == "year" else "QUARTER"
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
                        data: list[dict] = []
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

    # ------------------------------------------------------------------ #
    # GET /api/financial-report-metrics/<symbol>                         #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/financial-report-metrics/<symbol>")
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
        if cached:
            return jsonify(cached)

        fs_db_path = resolve_vci_financial_statement_db_path()
        if not fs_db_path or not os.path.exists(fs_db_path):
            return jsonify({"data": [], "field_map": {}})

        try:
            conn = sqlite3.connect(fs_db_path)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT field, title_vi, title_en, name
                FROM statement_metrics
                WHERE section = ?
                ORDER BY field
                """,
                (section,),
            ).fetchall()
            conn.close()

            data: list[dict] = []
            field_map: dict[str, str] = {}
            for r in rows:
                field = str(r["field"] or "").strip().lower()
                if not field:
                    continue
                label = (
                    str(r["title_vi"] or "").strip()
                    or str(r["title_en"] or "").strip()
                    or str(r["name"] or "").strip()
                    or field.upper()
                )
                data.append({"field": field, "label": label})
                field_map[field] = label

            result = {"data": data, "field_map": field_map}
            _cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error(f"GET /financial-report-metrics/{clean_symbol} error: {exc}")
            return jsonify({"error": str(exc)}), 500

    # ------------------------------------------------------------------ #
    # GET /api/batch-overview                                               #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/batch-overview")
    def api_batch_overview():
        """
        Return stock overview for multiple symbols at once.
        Query param: symbols=VCB,HPG,VNM (comma-separated, max 20)
        """
        symbols_param = request.args.get("symbols", "")
        if not symbols_param:
            return jsonify({"error": "Missing 'symbols' parameter"}), 400

        symbols = [s.strip().upper() for s in symbols_param.split(",") if s.strip()][:20]

        cache_key = f"batch_overview_{'_'.join(sorted(symbols))}"
        cached = _cache_get(cache_key)
        if cached:
            return jsonify(cached)

        provider = get_provider()
        result: dict = {}
        for sym in symbols:
            try:
                data = provider.get_stock_data(sym, period="year")
                if data and data.get("success"):
                    result[sym] = data
                else:
                    result[sym] = {"symbol": sym, "success": False}
            except Exception as exc:
                logger.warning(f"batch-overview error for {sym}: {exc}")
                result[sym] = {"symbol": sym, "success": False, "error": str(exc)}

        _cache_set(cache_key, result)
        return jsonify(result)

    # ------------------------------------------------------------------ #
    # GET /api/db/stats                                                     #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/db/stats")
    def api_db_stats():
        """Return high-level statistics about the local SQLite database."""
        cache_key = "db_stats"
        cached = _cache_get(cache_key)
        if cached:
            return jsonify(cached)

        db_path = resolve_stocks_db_path()
        if not db_path or not os.path.exists(db_path):
            return jsonify({"error": "Database not found"}), 503

        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            stats: dict = {"db_path": os.path.basename(db_path)}

            # File size
            stats["db_size_mb"] = round(os.path.getsize(db_path) / 1_048_576, 2)

            # Table row-counts for key tables
            for tbl in (
                "stocks",
                "financial_ratios",
                "income_statement",
                "balance_sheet",
                "cash_flow_statement",
                "overview",
                "news",
            ):
                try:
                    cur.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tbl,)
                    )
                    if cur.fetchone():
                        cnt = cur.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
                        stats[f"{tbl}_count"] = cnt
                except Exception:
                    pass

            # Distinct symbols with financial data
            try:
                cur.execute(
                    "SELECT COUNT(DISTINCT symbol) FROM financial_ratios"
                )
                row = cur.fetchone()
                stats["symbols_with_ratios"] = row[0] if row else 0
            except Exception:
                pass

            # Latest update timestamp
            try:
                row = cur.execute(
                    "SELECT MAX(updated_at) FROM stocks"
                ).fetchone()
                stats["latest_stock_update"] = row[0] if row else None
            except Exception:
                pass

            conn.close()
            stats["generated_at"] = datetime.utcnow().isoformat() + "Z"
            _cache_set(cache_key, stats)
            return jsonify(stats)
        except Exception as exc:
            logger.error(f"GET /db/stats error: {exc}")
            return jsonify({"error": str(exc)}), 500

    # ------------------------------------------------------------------ #
    # GET /api/stock/<symbol>/freshness                                     #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/stock/<symbol>/freshness")
    def api_stock_freshness(symbol: str):
        """
        Return data-freshness metadata for a symbol:
        when was price / financial data / news last updated in the local DB.
        """
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"error": clean_symbol}), 400

        db_path = resolve_stocks_db_path()
        if not db_path or not os.path.exists(db_path):
            return jsonify({"symbol": clean_symbol, "fresh": False, "error": "DB not found"}), 503

        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            freshness: dict = {"symbol": clean_symbol}

            # Stock record update
            try:
                row = cur.execute(
                    "SELECT updated_at FROM stocks WHERE ticker = ? LIMIT 1",
                    (clean_symbol,),
                ).fetchone()
                freshness["stock_updated_at"] = row["updated_at"] if row else None
            except Exception:
                pass

            # Latest financial ratio year/quarter
            try:
                row = cur.execute(
                    """
                    SELECT year, quarter, updated_at
                    FROM financial_ratios
                    WHERE symbol = ?
                    ORDER BY year DESC, quarter DESC NULLS LAST
                    LIMIT 1
                    """,
                    (clean_symbol,),
                ).fetchone()
                if row:
                    freshness["ratios_year"] = row["year"]
                    freshness["ratios_quarter"] = row["quarter"]
                    freshness["ratios_updated_at"] = row["updated_at"]
            except Exception:
                pass

            # Latest income statement
            try:
                row = cur.execute(
                    """
                    SELECT year, quarter, updated_at
                    FROM income_statement
                    WHERE symbol = ?
                    ORDER BY year DESC, quarter DESC NULLS LAST
                    LIMIT 1
                    """,
                    (clean_symbol,),
                ).fetchone()
                if row:
                    freshness["income_year"] = row["year"]
                    freshness["income_quarter"] = row["quarter"]
                    freshness["income_updated_at"] = row["updated_at"]
            except Exception:
                pass

            # Latest news
            try:
                row = cur.execute(
                    """
                    SELECT MAX(published_at) as latest
                    FROM news
                    WHERE symbol = ?
                    """,
                    (clean_symbol,),
                ).fetchone()
                freshness["news_latest_at"] = row["latest"] if row else None
            except Exception:
                pass

            conn.close()
            freshness["checked_at"] = datetime.utcnow().isoformat() + "Z"
            return jsonify(freshness)
        except Exception as exc:
            logger.error(f"GET /stock/{clean_symbol}/freshness error: {exc}")
            return jsonify({"error": str(exc)}), 500

    # ------------------------------------------------------------------ #
    # POST /api/valuation/<symbol>/sensitivity                              #
    # ------------------------------------------------------------------ #
    @stock_bp.route("/valuation/<symbol>/sensitivity", methods=["GET", "POST"])
    def api_valuation_sensitivity(symbol: str):
        """Return DCF sensitivity matrix (WACC-growth grid)."""
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"success": False, "error": clean_symbol}), 400

        body: dict = {}
        if request.method == "POST":
            body = request.get_json(silent=True) or {}
        try:
            result = get_valuation_service().calculate_sensitivity(clean_symbol, body)
            return jsonify(result), (200 if result.get("success") else 404)
        except Exception as exc:
            logger.error(f"sensitivity endpoint error {clean_symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
