from __future__ import annotations

import json
import logging
import os
import sqlite3
import statistics

from flask import Blueprint, jsonify, request

from backend.db_path import resolve_vci_company_db_path, resolve_vci_stats_financial_db_path
from backend.extensions import get_provider
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/peers/<symbol>")
    def api_stock_peers(symbol):
        """Get peer stocks for industry comparison."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400
            provider = get_provider()
            peers = provider.get_stock_peers(clean_symbol)
            return jsonify({"success": True, "data": peers})
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/peers-vci/<symbol>")
    def api_stock_peers_vci(symbol):
        """Get peer stocks with VCI stats financial data (PE, PB, ROE, ROA, EV/EBITDA).

        Uses vci_company.sqlite (icb_name2) for sector grouping, then vci_stats_financial.sqlite for metrics.
        """
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            company_db = resolve_vci_company_db_path()
            with sqlite3.connect(company_db) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT icb_name2, organ_name FROM companies WHERE UPPER(ticker) = ?",
                    (clean_symbol.upper(),),
                ).fetchone()

            if not row or not row["icb_name2"]:
                return jsonify({"success": True, "data": [], "medianPe": None, "industry": None})

            sector = row["icb_name2"]

            # Find all peer tickers in the same icb_name2 sector
            with sqlite3.connect(company_db) as conn:
                conn.row_factory = sqlite3.Row
                peer_rows = conn.execute(
                    "SELECT ticker, organ_name FROM companies WHERE icb_name2 = ?",
                    (sector,),
                ).fetchall()

            peer_tickers = [r["ticker"] for r in peer_rows]
            ticker_names = {r["ticker"]: r["organ_name"] or r["ticker"] for r in peer_rows}

            if not peer_tickers:
                return jsonify({"success": True, "data": [], "medianPe": None, "industry": sector})

            stats_db = resolve_vci_stats_financial_db_path()
            placeholders = ",".join(["?" for _ in peer_tickers])
            with sqlite3.connect(stats_db) as conn:
                conn.row_factory = sqlite3.Row
                stats_rows = conn.execute(
                    f"SELECT ticker, pe, pb, roe, roa, ev_to_ebitda, market_cap"
                    f" FROM stats_financial WHERE ticker IN ({placeholders})",
                    peer_tickers,
                ).fetchall()

            peers = []
            for r in stats_rows:
                peers.append({
                    "symbol": r["ticker"],
                    "name": ticker_names.get(r["ticker"], r["ticker"]),
                    "pe": r["pe"],
                    "pb": r["pb"],
                    "roe": r["roe"],
                    "roa": r["roa"],
                    "evEbitda": r["ev_to_ebitda"],
                    "marketCap": r["market_cap"],
                    "isCurrent": r["ticker"] == clean_symbol,
                })

            peers.sort(key=lambda x: (x["marketCap"] or 0), reverse=True)

            pe_values = sorted(p["pe"] for p in peers if p["pe"] and p["pe"] > 0)
            median_pe: float | None = None
            if pe_values:
                median_pe = statistics.median(pe_values)

            return jsonify({
                "success": True,
                "data": peers,
                "medianPe": median_pe,
                "industry": sector,
            })
        except Exception as exc:
            logger.exception("peers-vci error for %s", symbol)
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/<symbol>/stats-financial")
    def api_stock_stats_financial(symbol):
        """Return latest stats_financial row from vci_stats_financial.sqlite for one ticker."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            stats_db = resolve_vci_stats_financial_db_path()
            with sqlite3.connect(stats_db) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT * FROM stats_financial WHERE UPPER(ticker) = ? LIMIT 1",
                    (clean_symbol.upper(),),
                ).fetchone()

            if not row:
                return jsonify({"success": False, "error": f"Không tìm thấy dữ liệu stats_financial cho {clean_symbol}"}), 404

            return jsonify({
                "success": True,
                "symbol": clean_symbol.upper(),
                "data": [dict(row)],
            })
        except Exception as exc:
            logger.exception("stats-financial error for %s", symbol)
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/stats-financial/icb-l3-sectors")
    def api_stats_financial_icb_l3_sectors():
        """Return available ICB level-3 sectors from vci_company.sqlite."""
        try:
            company_db = resolve_vci_company_db_path()
            with sqlite3.connect(company_db) as conn:
                rows = conn.execute(
                    """
                    SELECT DISTINCT TRIM(icb_name3) AS icb_l3
                    FROM companies
                    WHERE icb_name3 IS NOT NULL AND TRIM(icb_name3) != ''
                    ORDER BY icb_l3
                    """
                ).fetchall()
            sectors = [r[0] for r in rows if r and r[0]]
            return jsonify({"success": True, "sectors": sectors})
        except Exception as exc:
            logger.exception("stats-financial icb-l3 sectors error")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/stats-financial")
    def api_stats_financial_by_sector():
        """Return stats_financial rows, optionally filtered by ICB level-3 sector."""
        try:
            icb_l3 = (request.args.get("icb_l3") or "").strip()

            company_db = resolve_vci_company_db_path()
            stats_db = resolve_vci_stats_financial_db_path()

            with sqlite3.connect(company_db) as conn:
                conn.row_factory = sqlite3.Row
                if icb_l3:
                    company_rows = conn.execute(
                        """
                        SELECT UPPER(ticker) AS ticker, organ_name, icb_name1, icb_name2, icb_name3, icb_name4
                        FROM companies
                        WHERE icb_name3 = ?
                        """,
                        (icb_l3,),
                    ).fetchall()
                else:
                    company_rows = conn.execute(
                        """
                        SELECT UPPER(ticker) AS ticker, organ_name, icb_name1, icb_name2, icb_name3, icb_name4
                        FROM companies
                        """
                    ).fetchall()

            company_map = {
                r["ticker"]: {
                    "company_name": r["organ_name"],
                    "icb_name1": r["icb_name1"],
                    "icb_name2": r["icb_name2"],
                    "icb_name3": r["icb_name3"],
                    "icb_name4": r["icb_name4"],
                }
                for r in company_rows
            }

            tickers = list(company_map.keys()) if icb_l3 else None
            if icb_l3 and not tickers:
                return jsonify({"success": True, "count": 0, "icb_l3": icb_l3, "data": []})

            with sqlite3.connect(stats_db) as conn:
                conn.row_factory = sqlite3.Row
                if tickers:
                    placeholders = ",".join(["?"] * len(tickers))
                    stats_rows = conn.execute(
                        f"""
                        SELECT * FROM stats_financial
                        WHERE UPPER(ticker) IN ({placeholders})
                        ORDER BY ticker
                        """,
                        tickers,
                    ).fetchall()
                else:
                    stats_rows = conn.execute(
                        "SELECT * FROM stats_financial ORDER BY ticker"
                    ).fetchall()

            data = []
            for row in stats_rows:
                item = dict(row)
                meta = company_map.get((item.get("ticker") or "").upper(), {})
                item.update(meta)
                data.append(item)

            return jsonify({
                "success": True,
                "count": len(data),
                "icb_l3": icb_l3 or None,
                "data": data,
            })
        except Exception as exc:
            logger.exception("stats-financial sector download error")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/tickers")
    def api_tickers():
        """Serve the latest ticker_data.json content."""
        try:
            root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            ticker_file = os.path.join(root_dir, "frontend-next", "public", "ticker_data.json")
            if not os.path.exists(ticker_file):
                ticker_file = os.path.join(root_dir, "frontend", "ticker_data.json")

            if os.path.exists(ticker_file):
                with open(ticker_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return jsonify(data)

            provider = get_provider()
            conn = provider.db._get_connection()
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT symbol, name, industry, exchange
                FROM company
                ORDER BY symbol
                """
            )
            rows = cursor.fetchall()
            conn.close()

            tickers = [
                {
                    "symbol": row[0],
                    "name": row[1] or row[0],
                    "sector": row[2] or "Unknown",
                    "exchange": row[3] or "Unknown",
                }
                for row in rows
            ]

            from datetime import datetime

            return jsonify(
                {
                    "last_updated": datetime.now().isoformat(),
                    "count": len(tickers),
                    "tickers": tickers,
                    "source": "database",
                }
            )
        except Exception as e:
            return jsonify({"error": str(e)}), 500
