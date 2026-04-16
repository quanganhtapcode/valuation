"""Split /api/stock/<symbol> into focused, lean endpoints.

Each endpoint returns only the data needed for a specific UI section,
reducing payload size and enabling independent caching.

Endpoints:
  GET /api/stock/<symbol>/summary        → Identity + live price + key ratios  (~500 B)
  GET /api/stock/<symbol>/profile        → Company description, established, employees  (~1.5 KB)
  GET /api/stock/<symbol>/ratio-history  → 12-year PE/PB/ROE/ROA/Debt series  (~1.5 KB)
  GET /api/stock/<symbol>/ratio-series   → Quarterly arrays: current_ratio, quick_ratio, ev_ebitda…  (~500 B)
  GET /api/stock/<symbol>/overview-full  → Legacy: all 4 combined (~4 KB, backward compat)
"""

from __future__ import annotations

import logging
import os
import sqlite3

import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request

from backend.db_path import resolve_vci_company_db_path
from backend.extensions import get_provider


logger = logging.getLogger(__name__)


def _read_vci_company(symbol: str) -> dict:
    """Read target_price and company_profile from vci_company.sqlite."""
    db = resolve_vci_company_db_path()
    if not db or not os.path.exists(db):
        return {}
    try:
        with sqlite3.connect(db) as conn:
            row = conn.execute(
                "SELECT target_price, company_profile FROM companies WHERE ticker = ?",
                (symbol.upper(),),
            ).fetchone()
            if row:
                return {
                    "target_price": float(row[0]) if row[0] is not None else None,
                    "company_profile": row[1] or None,
                }
    except Exception as exc:
        logger.warning("vci_company read failed for %s: %s", symbol, exc)
    return {}


def _convert_nan_to_none(obj):
    """Recursively convert NaN/NaT to None for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _convert_nan_to_none(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_nan_to_none(v) for v in obj]
    if pd.isna(obj):
        return None
    return obj


def _fetch_raw(symbol: str, period: str = "year") -> dict:
    """Fetch raw stock data from provider, cleaned of NaN."""
    provider = get_provider()
    raw = provider.get_stock_data(symbol, period, fetch_current_price=True)
    return _convert_nan_to_none(raw)


# ──────────────────────────────────────────────────────────────────────
# Endpoint 1: /api/stock/<symbol>/summary
# Identity + live price + key ratios  (~10-15 fields)
# Used by: Header bar, Overview quick stats
# ──────────────────────────────────────────────────────────────────────
_SUMMARY_FIELDS = [
    # Identity
    "symbol", "success", "name", "exchange", "industry",
    # Price
    "current_price", "price_change", "price_change_percent",
    "market_cap", "shares_outstanding", "bvps",
    # Valuation
    "pe", "pb", "ps", "pcf_ratio", "eps", "dividend_yield",
    # Quality
    "roe", "roa", "net_profit_margin", "gross_margin", "pre_tax_margin",
    # Growth
    "profit_growth", "revenue_growth",
    # Leverage
    "debt_to_equity", "financial_leverage", "current_ratio", "quick_ratio",
    # Banking
    "nim", "npl", "ldr", "cir", "casa", "isbank",
    # Other
    "ev_to_ebitda", "asset_turnover", "inventory_turnover", "cash_ratio", "roic", "ebit_margin",
    # VCI analyst target
    "target_price",
]


def _build_summary(raw: dict) -> dict:
    out = {"success": raw.get("success", False)}
    for field in _SUMMARY_FIELDS:
        val = raw.get(field)
        # Replace 0 with None for ratios that can't be zero
        # Booleans (isbank) are excluded because False == 0 in Python
        if field not in ("market_cap", "shares_outstanding", "current_price", "bvps", "eps",
                         "price_change", "price_change_percent", "isbank"):
            if val == 0 or val == 0.0:
                val = None
        out[field] = val
    return out


# ──────────────────────────────────────────────────────────────────────
# Endpoint 2: /api/stock/<symbol>/profile
# Company description and basic info  (~1-2 KB)
# Used by: Overview tab (expandable description)
# ──────────────────────────────────────────────────────────────────────
_PROFILE_FIELDS = [
    "symbol", "name", "exchange", "industry", "company_profile",
]


def _build_profile(raw: dict) -> dict:
    out = {"success": raw.get("success", False)}
    for field in _PROFILE_FIELDS:
        out[field] = raw.get(field)
    return out


# ──────────────────────────────────────────────────────────────────────
# Endpoint 3: /api/stock/<symbol>/ratio-history
# 12-year PE/PB/ROE/ROA/Debt series  (~1.5 KB)
# Used by: Overview tab (12-year ratio chart)
# ──────────────────────────────────────────────────────────────────────
def _build_ratio_history(raw: dict) -> dict:
    history = raw.get("history", [])
    if not isinstance(history, list):
        history = []

    # Keep only the fields the chart needs
    cleaned = []
    for item in history:
        if not isinstance(item, dict):
            continue
        cleaned.append({
            "period": item.get("period"),
            "pe": item.get("pe"),
            "pb": item.get("pb"),
            "ps": item.get("ps"),
            "roe": item.get("roe"),
            "roa": item.get("roa"),
            "nim": item.get("nim"),
            "debtToEquity": item.get("debtToEquity"),
        })

    return {"success": raw.get("success", False), "history": cleaned}


# ──────────────────────────────────────────────────────────────────────
# Endpoint 4: /api/stock/<symbol>/ratio-series
# Quarterly/annual arrays for mini-charts  (~500 B)
# Used by: Overview tab (Current Ratio, Quick Ratio, EV/EBITDA mini-charts)
# ──────────────────────────────────────────────────────────────────────
_SERIES_FIELDS = [
    "current_ratio_data", "quick_ratio_data", "ev_ebitda",
    "debt_to_equity_adjusted", "cash_ratio", "interest_coverage",
    "asset_turnover", "inventory_turnover", "ebit_margin",
]


def _build_ratio_series(raw: dict) -> dict:
    out = {"success": raw.get("success", False)}
    for field in _SERIES_FIELDS:
        out[field] = raw.get(field)
    return out


# ──────────────────────────────────────────────────────────────────────
# Endpoint 5: /api/stock/<symbol>/overview-full (backward compat)
# All 4 combined — legacy for downloads / old clients
# ──────────────────────────────────────────────────────────────────────
def _build_full_overview(raw: dict) -> dict:
    """Merge summary + profile + ratio-history + ratio-series into one response."""
    summary = _build_summary(raw)
    profile = _build_profile(raw)
    ratio_history = _build_ratio_history(raw)
    ratio_series = _build_ratio_series(raw)
    out = {**summary, **profile, **ratio_history, **ratio_series}
    return out


# ──────────────────────────────────────────────────────────────────────
# Blueprint registration
# ──────────────────────────────────────────────────────────────────────
def register(stock_bp: Blueprint) -> None:

    @stock_bp.route("/stock/<symbol>/summary")
    def api_stock_summary(symbol: str):
        """Lightweight stock summary: identity + price + key ratios (~500 B)."""
        try:
            sym = symbol.upper()
            raw = _fetch_raw(sym)
            if not raw.get("success"):
                return jsonify({"success": False, "error": "Symbol not found"}), 404
            result = _build_summary(raw)
            # Inject target_price from vci_company.sqlite (not in provider chain)
            vci = _read_vci_company(sym)
            if result.get("target_price") is None and vci.get("target_price") is not None:
                result["target_price"] = vci["target_price"]
            return jsonify(result)
        except Exception as exc:
            logger.error(f"API /stock/{symbol}/summary error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/<symbol>/profile")
    def api_stock_profile(symbol: str):
        """Company profile: description, established date, employees (~1.5 KB)."""
        try:
            sym = symbol.upper()
            raw = _fetch_raw(sym)
            if not raw.get("success"):
                return jsonify({"success": False, "error": "Symbol not found"}), 404
            result = _build_profile(raw)
            # Inject company_profile from vci_company.sqlite if not already present
            vci = _read_vci_company(sym)
            if not result.get("company_profile") and vci.get("company_profile"):
                result["company_profile"] = vci["company_profile"]
            return jsonify(result)
        except Exception as exc:
            logger.error(f"API /stock/{symbol}/profile error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/<symbol>/ratio-history")
    def api_stock_ratio_history(symbol: str):
        """12-year PE/PB/ROE/ROA/Debt ratio history (~1.5 KB)."""
        try:
            raw = _fetch_raw(symbol.upper())
            if not raw.get("success"):
                return jsonify({"success": False, "error": "Symbol not found"}), 404
            return jsonify(_build_ratio_history(raw))
        except Exception as exc:
            logger.error(f"API /stock/{symbol}/ratio-history error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/<symbol>/ratio-series")
    def api_stock_ratio_series(symbol: str):
        """Quarterly/annual ratio arrays for mini-charts (~500 B)."""
        try:
            raw = _fetch_raw(symbol.upper())
            if not raw.get("success"):
                return jsonify({"success": False, "error": "Symbol not found"}), 404
            return jsonify(_build_ratio_series(raw))
        except Exception as exc:
            logger.error(f"API /stock/{symbol}/ratio-series error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/stock/<symbol>/overview-full")
    def api_stock_overview_full(symbol: str):
        """Full overview: summary + profile + ratio-history + ratio-series (~4 KB, legacy compat)."""
        try:
            raw = _fetch_raw(symbol.upper())
            if not raw.get("success"):
                return jsonify({"success": False, "error": "Symbol not found"}), 404
            return jsonify(_build_full_overview(raw))
        except Exception as exc:
            logger.error(f"API /stock/{symbol}/overview-full error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
