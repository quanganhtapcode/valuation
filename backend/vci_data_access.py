"""Unified VCI SQLite data access layer.

Replaces the old monolithic stocks_optimized.db with distributed VCI sources:
- vci_screening.sqlite   → price, market cap, sector, exchange
- vci_stats_financial.sqlite → PE, PB, ROE, ROA, banking KPIs
- vci_ratio_daily.sqlite → daily PE/PB history
- vci_company.sqlite     → company names, ICB sectors, logos
- vci_financials.sqlite  → balance sheet, income statement, cash flow (wide format)
- vci_shareholders.sqlite → shareholder lists
- price_history.sqlite   → daily OHLCV
"""

from __future__ import annotations

import logging
import sqlite3
from contextlib import contextmanager
from typing import Optional

from backend.db_path import (
    resolve_vci_screening_db_path,
    resolve_vci_stats_financial_db_path,
    resolve_vci_company_db_path,
    resolve_vci_financial_statement_db_path,
    resolve_vci_shareholders_db_path,
    resolve_price_history_db_path,
)

logger = logging.getLogger(__name__)


@contextmanager
def _connect(db_path: str):
    """Context manager for SQLite connections with row factory."""
    import os
    if not db_path or not os.path.exists(db_path):
        yield None
        return
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        yield conn
    except Exception as e:
        logger.warning(f"SQLite connect failed for {db_path}: {e}")
        yield None
    finally:
        try:
            conn.close()
        except Exception:
            pass


class VCIDataAccess:
    """Unified access layer for all VCI SQLite databases."""

    # ── Company info ────────────────────────────────────────────────────
    def get_company_info(self, symbol: str) -> dict | None:
        """Get company name, sector, exchange from vci_company + screening."""
        # Primary: vci_company.sqlite
        db_path = resolve_vci_company_db_path()
        with _connect(db_path) as conn:
            if conn is not None:
                row = conn.execute(
                    "SELECT * FROM companies WHERE ticker = ?", (symbol,)
                ).fetchone()
                if row:
                    d = dict(row)
                    return {
                        "symbol": d["ticker"],
                        "name": d.get("organ_name") or d.get("short_name") or symbol,
                        "en_name": d.get("en_organ_name") or d.get("en_short_name"),
                        "short_name": d.get("short_name"),
                        "floor": d.get("floor"),
                        "exchange": d.get("floor"),
                        "sector": d.get("en_icb_name3") or d.get("icb_name3") or "Unknown",
                        "sector_lv2": d.get("en_icb_name2") or d.get("icb_name2"),
                        "sector_lv4": d.get("en_icb_name4") or d.get("icb_name4"),
                        "icb_code": d.get("icb_code4") or d.get("icb_code3"),
                        "logo_url": d.get("logo_url"),
                        "isbank": bool(d.get("isbank")),
                    }

        # Fallback: vci_screening.sqlite
        screen_db = resolve_vci_screening_db_path()
        with _connect(screen_db) as conn:
            if conn is not None:
                row = conn.execute(
                    "SELECT * FROM screening_data WHERE ticker = ?", (symbol,)
                ).fetchone()
                if row:
                    d = dict(row)
                    return {
                        "symbol": d["ticker"],
                        "name": d.get("enOrganName") or d.get("viOrganName") or symbol,
                        "exchange": d.get("exchange"),
                        "sector": d.get("enSector") or d.get("viSector") or "Unknown",
                    }

        return None

    # ── Current ratios (TTM) ────────────────────────────────────────────
    def get_current_ratios(self, symbol: str) -> dict | None:
        """Get latest PE, PB, ROE, ROA, market_cap from vci_stats_financial."""
        db_path = resolve_vci_stats_financial_db_path()
        with _connect(db_path) as conn:
            if conn is None:
                return None
            row = conn.execute(
                "SELECT * FROM stats_financial WHERE ticker = ?", (symbol,)
            ).fetchone()
            if row:
                d = dict(row)
                return {
                    "pe": d.get("pe"),
                    "pb": d.get("pb"),
                    "ps": d.get("ps"),
                    "roe": d.get("roe"),
                    "roa": d.get("roa"),
                    "gross_margin": d.get("gross_margin"),
                    "net_margin": d.get("after_tax_margin") or d.get("net_margin"),
                    "ebit_margin": d.get("ebit_margin"),
                    "current_ratio": d.get("current_ratio"),
                    "quick_ratio": d.get("quick_ratio"),
                    "cash_ratio": d.get("cash_ratio"),
                    "debt_to_equity": d.get("debt_to_equity"),
                    "financial_leverage": d.get("financial_leverage"),
                    "asset_turnover": d.get("asset_turnover"),
                    "inventory_turnover": d.get("inventory_turnover"),
                    "market_cap": d.get("market_cap"),
                    "shares": d.get("shares"),
                    # Banking KPIs
                    "nim": d.get("net_interest_margin"),
                    "car": d.get("car"),
                    "casa": d.get("casa_ratio"),
                    "npl": d.get("npl"),
                    "ldr": d.get("ldr"),
                    "cir": d.get("cir"),
                }
        return None

    # ── Ratio history (quarterly) ───────────────────────────────────────
    def get_ratio_history(self, symbol: str) -> list[dict]:
        """Get quarterly ratio history from vci_stats_financial_history."""
        db_path = resolve_vci_stats_financial_db_path()
        with _connect(db_path) as conn:
            if conn is None:
                return []
            # Only select columns that exist in stats_financial_history
            rows = conn.execute(
                """
                SELECT ticker, year_report, quarter_report,
                       pe, pb, ps, roe, roa, gross_margin,
                       after_tax_margin, net_interest_margin,
                       car, casa_ratio, npl, ldr
                FROM stats_financial_history
                WHERE ticker = ?
                ORDER BY year_report ASC, quarter_report ASC
                """,
                (symbol,),
            ).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                result.append({
                    "year": d.get("year_report"),
                    "quarter": d.get("quarter_report"),
                    "pe": d.get("pe"),
                    "pb": d.get("pb"),
                    "roe": d.get("roe"),
                    "roa": d.get("roa"),
                    "gross_margin": d.get("gross_margin"),
                    "net_margin": d.get("after_tax_margin"),
                    "nim": d.get("net_interest_margin"),
                    "car": d.get("car"),
                    "casa_ratio": d.get("casa_ratio"),
                    "npl": d.get("npl"),
                    "ldr": d.get("ldr"),
                })
            return result

    # ── Financial statements (wide format) ──────────────────────────────
    def get_financial_statement(
        self, symbol: str, statement_type: str, limit: int = 24
    ) -> list[dict]:
        """Get income/balance/cashflow from vci_financials.sqlite (wide format).

        statement_type: 'income', 'balance', 'cashflow'
        Returns list of dicts with year, quarter, and all field codes.
        """
        table_map = {
            "income": "income_statement",
            "balance": "balance_sheet",
            "cashflow": "cash_flow",
        }
        table = table_map.get(statement_type)
        if not table:
            return []

        db_path = resolve_vci_financial_statement_db_path()
        with _connect(db_path) as conn:
            if conn is None:
                return []
            rows = conn.execute(
                f"""
                SELECT * FROM {table}
                WHERE ticker = ?
                ORDER BY year_report DESC, quarter_report DESC
                LIMIT ?
                """,
                (symbol, limit),
            ).fetchall()
            return [dict(r) for r in rows] if rows else []

    # ── Shareholders ────────────────────────────────────────────────────
    def get_shareholders(self, symbol: str) -> list[dict]:
        """Get shareholders from vci_shareholders.sqlite."""
        db_path = resolve_vci_shareholders_db_path()
        with _connect(db_path) as conn:
            if conn is None:
                return []
            rows = conn.execute(
                """
                SELECT owner_code, owner_name, owner_name_en,
                       position_name, position_name_en,
                       quantity, percentage, owner_type,
                       update_date, public_date
                FROM shareholders
                WHERE ticker = ?
                ORDER BY percentage DESC
                """,
                (symbol,),
            ).fetchall()
            return [dict(r) for r in rows] if rows else []

    # ── Price history ───────────────────────────────────────────────────
    def get_price_history(self, symbol: str, limit: int = 250) -> list[dict]:
        """Get daily OHLCV from price_history.sqlite."""
        db_path = resolve_price_history_db_path()
        with _connect(db_path) as conn:
            if conn is None:
                return []
            rows = conn.execute(
                """
                SELECT time, open, high, low, close, volume
                FROM stock_price_history
                WHERE symbol = ?
                ORDER BY time DESC
                LIMIT ?
                """,
                (symbol, limit),
            ).fetchall()
            return [dict(r) for r in rows] if rows else []

    # ── Combined overview (replaces old 'overview' table) ───────────────
    def get_overview_data(self, symbol: str) -> dict:
        """Combined overview with stats/company as primary and screening as fallback.

        Primary for stock-detail:
        - vci_stats_financial.sqlite: ratios, shares/market_cap
        - vci_company.sqlite: identity/sector/exchange
        Fallback:
        - vci_screening.sqlite: snapshot market fields if missing
        """
        result: dict = {"symbol": symbol}

        # 1. Stats financial (PE, PB, ROE, etc.) as primary metrics source
        stats_db = resolve_vci_stats_financial_db_path()
        with _connect(stats_db) as conn:
            if conn is not None:
                row = conn.execute(
                    "SELECT * FROM stats_financial WHERE ticker = ?", (symbol,)
                ).fetchone()
                if row:
                    d = dict(row)
                    result.update({
                        "pe": d.get("pe"),
                        "pb": d.get("pb"),
                        "ps": d.get("ps"),
                        "roe": d.get("roe"),
                        "roa": d.get("roa"),
                        "eps": d.get("eps"),
                        "bvps": d.get("bvps"),
                        "net_margin": d.get("after_tax_margin"),
                        "gross_margin": d.get("gross_margin"),
                        "current_ratio": d.get("current_ratio"),
                        "quick_ratio": d.get("quick_ratio"),
                        "debt_to_equity": d.get("debt_to_equity"),
                        "nim": d.get("net_interest_margin"),
                        "car": d.get("car"),
                        "casa": d.get("casa_ratio"),
                        "npl": d.get("npl"),
                        "ldr": d.get("ldr"),
                        # VCI stores costToIncome as negative (net-income/total-income sign),
                        # take abs() so frontend can display it as a positive CIR %.
                        "cir": abs(d.get("cir")) if d.get("cir") is not None else None,
                    })

        # 2. Company info (name, sector detail) as primary identity source
        company = self.get_company_info(symbol)
        if company:
            # Company info has better sector data (icb_name3/4) - use it for sector
            result.update({
                'name': company.get('name', result.get('name')),
                'sector': company.get('sector'),  # Always prefer company's sector
                'industry': company.get('sector'),
                'sector_lv2': company.get('sector_lv2'),
                'sector_lv4': company.get('sector_lv4'),
                'floor': company.get('floor', result.get('floor')),
                'exchange': company.get('exchange', result.get('exchange')),
                'logo_url': company.get('logo_url'),
                'isbank': company.get('isbank'),
            })

        # 3. Screening snapshot fallback (only fill missing fields)
        screen_db = resolve_vci_screening_db_path()
        with _connect(screen_db) as conn:
            if conn is not None:
                row = conn.execute(
                    "SELECT * FROM screening_data WHERE ticker = ?", (symbol,)
                ).fetchone()
                if row:
                    d = dict(row)
                    snapshot = {
                        "exchange": d.get("exchange"),
                        "current_price": d.get("marketPrice"),
                        "ref_price": d.get("refPrice"),
                        "ceiling": d.get("ceiling"),
                        "floor": d.get("floor"),
                        "floor_price": d.get("floor"),
                        "market_cap": d.get("marketCap"),
                        "price_change_pct": d.get("dailyPriceChangePercent"),
                        "accumulated_volume": d.get("accumulatedVolume"),
                        "accumulated_value": d.get("accumulatedValue"),
                        "sector": d.get("enSector") or d.get("viSector"),
                        "icb_code": d.get("icbCodeLv3") or d.get("icbCodeLv2"),
                    }
                    for key, value in snapshot.items():
                        if result.get(key) is None and value is not None:
                            result[key] = value

        return result
