"""Industry peers and comparable stock valuations."""

from __future__ import annotations

import json
import logging
from flask import Blueprint, jsonify, request
from backend.db_path import resolve_vci_company_db_path, resolve_vci_stats_financial_db_path
from backend.extensions import get_provider
from backend.utils import validate_stock_symbol
import statistics
from backend.sqlite_utils import read_connection

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
        """Get peer stocks with VCI stats financial data.

        Query params:
          mode=quarter (default) — latest TTM from stats_financial
          mode=year              — latest annual from stats_financial_history (quarter_report=5)
        """
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            mode = request.args.get("mode", "quarter")
            if mode not in ("quarter", "year"):
                mode = "quarter"

            company_db = resolve_vci_company_db_path()
            with read_connection(company_db) as conn:
                row = conn.execute(
                    "SELECT icb_name2, organ_name FROM companies WHERE UPPER(ticker) = ?",
                    (clean_symbol.upper(),),
                ).fetchone()

            if not row or not row["icb_name2"]:
                return jsonify({"success": True, "data": [], "medianPe": None, "industry": None, "period": None})

            sector = row["icb_name2"]

            with read_connection(company_db) as conn:
                peer_rows = conn.execute(
                    "SELECT ticker, organ_name FROM companies WHERE icb_name2 = ?",
                    (sector,),
                ).fetchall()

            peer_tickers = [r["ticker"] for r in peer_rows]
            ticker_names = {r["ticker"]: r["organ_name"] or r["ticker"] for r in peer_rows}

            if not peer_tickers:
                return jsonify({"success": True, "data": [], "medianPe": None, "industry": sector, "period": None})

            stats_db = resolve_vci_stats_financial_db_path()
            placeholders = ",".join(["?" for _ in peer_tickers])

            if mode == "year":
                with read_connection(stats_db) as conn:
                    stats_rows = conn.execute(
                        f"""
                        SELECT h.ticker, h.pe, h.pb, h.roe, h.roa, h.market_cap, h.ev_to_ebitda,
                               h.net_interest_margin, h.cir, h.casa_ratio, h.npl,
                               h.ldr, h.loans_growth, h.deposit_growth,
                               h.year_report, h.quarter_report
                        FROM stats_financial_history h
                        INNER JOIN (
                            SELECT ticker, MAX(year_report) AS max_year
                            FROM stats_financial_history
                            WHERE quarter_report = 5 AND ticker IN ({placeholders})
                            GROUP BY ticker
                        ) latest ON h.ticker = latest.ticker AND h.year_report = latest.max_year
                        WHERE h.quarter_report = 5
                        """,
                        peer_tickers,
                    ).fetchall()
                period = None
                if stats_rows:
                    period = f"Năm {stats_rows[0]['year_report']}"
            else:
                with read_connection(stats_db) as conn:
                    stats_rows = conn.execute(
                        f"""
                        SELECT ticker, pe, pb, roe, roa, market_cap, ev_to_ebitda,
                               net_interest_margin, cir, casa_ratio, npl,
                               ldr, loans_growth, deposit_growth,
                               NULL AS year_report, NULL AS quarter_report
                        FROM stats_financial
                        WHERE ticker IN ({placeholders})
                        """,
                        peer_tickers,
                    ).fetchall()
                period = None
                with read_connection(stats_db) as conn:
                    raw = conn.execute(
                        "SELECT raw_json FROM stats_financial WHERE ticker = ?",
                        (clean_symbol.upper(),),
                    ).fetchone()
                    if raw and raw[0]:
                        try:
                            raw_data = json.loads(raw[0])
                            yr = raw_data.get("year") or raw_data.get("yearReport")
                            qt = raw_data.get("quarter")
                            if yr and qt:
                                period = f"TTM Q{qt}/{yr}"
                        except Exception:
                            pass

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
                    "nim": r["net_interest_margin"],
                    "cir": r["cir"],
                    "casa": r["casa_ratio"],
                    "npl": r["npl"],
                    "ldr": r["ldr"],
                    "loansGrowth": r["loans_growth"],
                    "depositGrowth": r["deposit_growth"],
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
                "period": period,
            })
        except Exception as exc:
            logger.exception("peers-vci error for %s", symbol)
            return jsonify({"success": False, "error": str(exc)}), 500
