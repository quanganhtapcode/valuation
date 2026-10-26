"""Financial metrics for stocks and industry sectors."""

from __future__ import annotations

import logging
from flask import Blueprint, jsonify, request
from backend.db_path import resolve_vci_company_db_path, resolve_vci_stats_financial_db_path
from backend.utils import validate_stock_symbol
from backend.sqlite_utils import read_connection

logger = logging.getLogger(__name__)

def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>/stats-financial")
    def api_stock_stats_financial(symbol):
        """Return latest stats_financial row from vci_stats_financial.sqlite for one ticker."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            stats_db = resolve_vci_stats_financial_db_path()
            with read_connection(stats_db) as conn:
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
            with read_connection(company_db) as conn:
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

            with read_connection(stats_db) as conn:
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
                    LEFT JOIN cmp.companies c ON c.ticker = s.ticker COLLATE NOCASE
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
