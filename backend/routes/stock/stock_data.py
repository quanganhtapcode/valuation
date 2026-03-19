from __future__ import annotations

import logging

import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request

from backend.extensions import get_provider


logger = logging.getLogger(__name__)


def _convert_nan_to_none(obj):
    if isinstance(obj, dict):
        return {k: _convert_nan_to_none(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_nan_to_none(v) for v in obj]
    if pd.isna(obj):
        return None
    return obj


# Fields that are internal plumbing — never useful to API consumers
_INTERNAL_FIELDS = {
    "data_source", "data_period", "source_priority",
    "ratios_source_table", "fresh_metrics_source",
    "ratios_quarter", "ratios_year",
}

# Duplicate aliases — second name is removed, first is kept
# Format: (canonical_keep, alias_to_remove)
_ALIAS_PAIRS = [
    ("pe",                "pe_ratio"),
    ("pe",                "pe_ttm"),
    ("pb",                "pb_ratio"),
    ("pb",                "pb_ttm"),
    ("nim",               "net_interest_margin"),
    ("npl",               "npl_ratio"),
    ("casa",              "casa_ratio"),
    ("net_profit_margin", "net_margin"),
    ("market_cap",        "marketCap"),
    ("company_profile",   "overview"),   # overview is just { description: company_profile }
]

# Chart series that are always empty for this endpoint — strip them
_ALWAYS_EMPTY_SERIES = {"casa_data", "npl_data", "profit_data", "revenue_data"}

# roa_data and roe_data are stored as fractions (0.013) — multiply by 100 for consistency
_FRACTION_SERIES = {"roa_data", "roe_data"}


def _clean_stock_response(data: dict) -> dict:
    """Strip internal noise from the stock data dict before sending to the client."""
    if not isinstance(data, dict) or not data.get("success"):
        return data

    out = dict(data)

    # 1. Remove internal/debug fields
    for key in _INTERNAL_FIELDS:
        out.pop(key, None)

    # 2. Remove all _source suffix fields  (e.g. roe_source, nim_source, …)
    source_keys = [k for k in out if k.endswith("_source")]
    for key in source_keys:
        out.pop(key, None)

    # 3. Remove duplicate aliases — keep the canonical name
    for canonical, alias in _ALIAS_PAIRS:
        if alias in out:
            # Only remove the alias; the canonical value may already be correct.
            # If canonical is missing but alias has a value, promote it first.
            if canonical not in out or out[canonical] is None:
                out[canonical] = out.pop(alias)
            else:
                out.pop(alias)

    # 4. Remove always-empty series arrays
    for key in _ALWAYS_EMPTY_SERIES:
        out.pop(key, None)

    # 5. Remove any other list fields that are empty or all-zero
    empty_list_keys = [
        k for k, v in out.items()
        if isinstance(v, list) and (len(v) == 0 or all(x == 0 or x is None for x in v))
        and k != "years"   # keep years even if empty — consumers may check it
    ]
    for key in empty_list_keys:
        out.pop(key, None)

    # 6. Fix roa_data / roe_data stored as fractions → convert to percentages
    for key in _FRACTION_SERIES:
        if key in out and isinstance(out[key], list):
            vals = out[key]
            # Only convert if values look like fractions (all non-None absolute values < 1)
            non_none = [v for v in vals if v is not None]
            if non_none and all(abs(v) < 1 for v in non_none):
                out[key] = [round(v * 100, 4) if v is not None else None for v in vals]

    # 7. Flatten overview.description → top-level description (then drop overview)
    if isinstance(out.get("overview"), dict):
        desc = out["overview"].get("description")
        if desc and not out.get("description"):
            out["description"] = desc
        out.pop("overview", None)

    # 8. Build a history array-of-objects alongside the existing parallel arrays
    years = out.get("years") or []
    series_keys = [
        ("pe_ratio_data", "pe"),
        ("pb_ratio_data", "pb"),
        ("ps_ratio_data", "ps"),
        ("roe_data",      "roe"),
        ("roa_data",      "roa"),
        ("nim_data",      "nim"),
        ("debt_to_equity_data", "debtToEquity"),
    ]
    if years:
        history = []
        for i, year in enumerate(years):
            record: dict = {"period": year}
            for arr_key, field in series_keys:
                arr = out.get(arr_key)
                if arr and i < len(arr):
                    v = arr[i]
                    record[field] = v if v != 0 else None
                else:
                    record[field] = None
            history.append(record)
        out["history"] = history

    # 9. Re-order keys: identity first, then price, then ratios, then history, rest last
    priority = [
        "success", "symbol", "name", "exchange", "industry", "sector",
        "description", "company_profile",
        "current_price", "market_cap", "shares_outstanding", "bvps",
        "pe", "pb", "ps", "pcf_ratio", "eps", "eps_ttm", "dividend_yield",
        "roe", "roa", "roic", "nim", "net_profit_margin", "gross_margin",
        "pre_tax_margin", "profit_growth", "revenue_growth",
        "debt_to_equity", "financial_leverage", "current_ratio", "quick_ratio",
        "car", "casa", "npl", "ldr", "cir", "cof", "llr_coverage",
        "fee_income_ratio", "yield_on_assets", "deposit_growth", "loans_growth",
        "p_cash_flow", "ev_to_ebitda",
        "history", "years",
    ]
    ordered: dict = {}
    for k in priority:
        if k in out:
            ordered[k] = out.pop(k)
    ordered.update(out)   # append anything not in priority list at the end

    return ordered


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>")
    def api_stock(symbol):
        """
        Stock summary: fundamentals, ratios, and historical series.

        Returns a single flat object with grouped fields:
          identity  — symbol, name, exchange, industry, description
          price     — current_price, market_cap, shares_outstanding, bvps
          valuation — pe, pb, ps, eps, dividend_yield
          quality   — roe, roa, nim, net_profit_margin, gross_margin
          growth    — profit_growth, revenue_growth
          leverage  — debt_to_equity, car, casa, npl, ldr, cir, cof
          history   — array of { period, pe, pb, roe, roa, nim, ... } (oldest→newest)
          years     — parallel period labels (legacy, kept for compat)
        """
        provider = get_provider()
        try:
            period = request.args.get("period", "year")
            fetch_price = request.args.get("fetch_price", "false").lower() == "true"
            data = provider.get_stock_data(symbol, period, fetch_current_price=fetch_price)
            cleaned = _clean_stock_response(_convert_nan_to_none(data))
            return jsonify(cleaned)
        except Exception as exc:
            logger.error(f"API /stock error {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/app-data/<symbol>")
    def api_app(symbol):
        """Get app-specific stock data (simplified for mobile/app usage)."""
        provider = get_provider()
        try:
            period = request.args.get("period", "year")
            fetch_price = request.args.get("fetch_price", "false").lower() == "true"
            data = provider.get_stock_data(symbol, period, fetch_current_price=fetch_price)

            if data.get("success") and period == "quarter":
                yearly_data = provider.get_stock_data(symbol, "year")
                roe_quarter = data.get("roe")
                roa_quarter = data.get("roa")
                if pd.isna(roe_quarter):
                    roe_quarter = yearly_data.get("roe")
                if pd.isna(roa_quarter):
                    roa_quarter = yearly_data.get("roa")
                data["roe"] = roe_quarter
                data["roa"] = roa_quarter

            if data.get("success"):
                if pd.isna(data.get("earnings_per_share", np.nan)):
                    data["earnings_per_share"] = data.get("eps_ttm", np.nan)

            cleaned = _clean_stock_response(_convert_nan_to_none(data))
            return jsonify(cleaned)
        except Exception as exc:
            logger.error(f"API /app-data error {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
