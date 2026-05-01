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
            with sqlite3.connect(company_db) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT icb_name2, organ_name FROM companies WHERE UPPER(ticker) = ?",
                    (clean_symbol.upper(),),
                ).fetchone()

            if not row or not row["icb_name2"]:
                return jsonify({"success": True, "data": [], "medianPe": None, "industry": None, "period": None})

            sector = row["icb_name2"]

            with sqlite3.connect(company_db) as conn:
                conn.row_factory = sqlite3.Row
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
                with sqlite3.connect(stats_db) as conn:
                    conn.row_factory = sqlite3.Row
                    stats_rows = conn.execute(
                        f"""
                        SELECT h.ticker, h.pe, h.pb, h.roe, h.roa, h.market_cap,
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
                with sqlite3.connect(stats_db) as conn:
                    conn.row_factory = sqlite3.Row
                    stats_rows = conn.execute(
                        f"""
                        SELECT ticker, pe, pb, roe, roa, market_cap,
                               net_interest_margin, cir, casa_ratio, npl,
                               ldr, loans_growth, deposit_growth,
                               NULL AS year_report, NULL AS quarter_report
                        FROM stats_financial
                        WHERE ticker IN ({placeholders})
                        """,
                        peer_tickers,
                    ).fetchall()
                period = None
                with sqlite3.connect(stats_db) as conn:
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
                    "evEbitda": None,
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
                    """
                    SELECT
                        ticker, pe, pb, ps, price_to_cash_flow, ev_to_ebitda,
                        roe, roa, gross_margin, pre_tax_margin, after_tax_margin,
                        net_interest_margin, cir, car, casa_ratio, npl, ldr,
                        loans_growth, deposit_growth, debt_to_equity, financial_leverage,
                        current_ratio, quick_ratio, cash_ratio, asset_turnover,
                        market_cap, shares, period_date, fetched_at
                    FROM stats_financial
                    WHERE UPPER(ticker) = ?
                    LIMIT 1
                    """,
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
            include_raw = (request.args.get("include_raw") or "").strip().lower() in {"1", "true", "yes"}

            company_db = resolve_vci_company_db_path()
            stats_db = resolve_vci_stats_financial_db_path()

            with sqlite3.connect(stats_db) as conn:
                conn.row_factory = sqlite3.Row
                conn.execute(f"ATTACH DATABASE '{company_db}' AS cmp")
                raw_col = ", s.raw_json" if include_raw else ""
                stats_rows = conn.execute(
                    f"""
                    SELECT
                        s.ticker, s.pe, s.pb, s.ps, s.price_to_cash_flow, s.ev_to_ebitda,
                        s.roe, s.roa, s.gross_margin, s.pre_tax_margin, s.after_tax_margin,
                        s.net_interest_margin, s.cir, s.car, s.casa_ratio, s.npl, s.ldr,
                        s.loans_growth, s.deposit_growth, s.debt_to_equity, s.financial_leverage,
                        s.current_ratio, s.quick_ratio, s.cash_ratio, s.asset_turnover,
                        s.market_cap, s.shares, s.period_date, s.fetched_at,
                        c.organ_name AS company_name, c.icb_name1, c.icb_name2, c.icb_name3, c.icb_name4
                        {raw_col}
                    FROM stats_financial s
                    LEFT JOIN cmp.companies c ON UPPER(c.ticker) = UPPER(s.ticker)
                    WHERE (? = '' OR TRIM(COALESCE(c.icb_name3, '')) = TRIM(?))
                    ORDER BY s.ticker
                    """,
                    (icb_l3, icb_l3),
                ).fetchall()
                conn.execute("DETACH DATABASE cmp")

            data = [dict(row) for row in stats_rows]

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
            if not os.path.exists(ticker_file):
                return jsonify({"error": "ticker_data.json not found"}), 503
            with open(ticker_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            return jsonify(data)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
