from __future__ import annotations

import logging

import pandas as pd
from flask import Blueprint, jsonify
from vnstock import Company

from backend.utils import validate_stock_symbol
from .cache import cache_get, cache_set


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/company/profile/<symbol>")
    def get_company_profile(symbol):
        """Get company overview/description from vnstock API (VietCap source)."""
        try:
            is_valid, result = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"error": result, "success": False}), 400
            symbol = result

            cache_key = f"profile_{symbol}"
            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            try:
                company = Company(symbol=symbol, source="VCI")
                overview_df = company.overview()
                if overview_df is None or (hasattr(overview_df, "empty") and overview_df.empty):
                    return jsonify({"success": False, "message": "No overview data available"}), 404

                def safe_get(df, column, default=""):
                    try:
                        if hasattr(df, "columns") and column in df.columns:
                            val = df[column].iloc[0]
                            if pd.notna(val):
                                return str(val)
                        return default
                    except Exception:
                        return default

                company_profile_text = safe_get(overview_df, "company_profile", "")
                history = safe_get(overview_df, "history", "")
                industry = safe_get(overview_df, "icb_name3", "")

                profile_result = {
                    "symbol": symbol,
                    "company_name": symbol,
                    "company_profile": company_profile_text or history,
                    "industry": industry,
                    "charter_capital": safe_get(overview_df, "charter_capital", ""),
                    "issue_share": safe_get(overview_df, "issue_share", ""),
                    "history": history[:300] + "..." if len(history) > 300 else history,
                    "success": True,
                }
                cache_set(cache_key, profile_result)
                return jsonify(profile_result)
            except Exception as e:
                logger.error(f"Error fetching overview for {symbol}: {e}")
                return jsonify({"success": False, "error": str(e)}), 500
        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500
