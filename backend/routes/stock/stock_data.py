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


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/stock/<symbol>")
    def api_stock(symbol):
        """Get stock summary data (financials, ratios)."""
        provider = get_provider()
        try:
            period = request.args.get("period", "year")
            fetch_price = request.args.get("fetch_price", "false").lower() == "true"
            data = provider.get_stock_data(symbol, period, fetch_current_price=fetch_price)
            return jsonify(_convert_nan_to_none(data))
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
                return jsonify(_convert_nan_to_none(data))
            return jsonify(data)
        except Exception as exc:
            logger.error(f"API /app-data error {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
