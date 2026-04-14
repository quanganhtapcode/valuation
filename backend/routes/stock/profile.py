from __future__ import annotations

import json
import logging
from pathlib import Path

from flask import Blueprint, jsonify

from backend.utils import validate_stock_symbol
from backend.cache_utils import cache_get, cache_set
from backend.db_path import _project_root


logger = logging.getLogger(__name__)

# Load company profile data from exported JSON
_PROFILE_JSON_PATH = _project_root() / "company_profile_export.json"

_company_profiles = {}

def _load_profiles():
    global _company_profiles
    if _company_profiles or not _PROFILE_JSON_PATH.exists():
        return
    try:
        with open(_PROFILE_JSON_PATH, "r", encoding="utf-8") as f:
            _company_profiles = json.load(f)
        logger.info(f"Loaded {len(_company_profiles)} company profiles from JSON")
    except Exception as e:
        logger.warning(f"Failed to load company profiles from JSON: {e}")


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/company/profile/<symbol>")
    def get_company_profile(symbol):
        """Get company overview/description from JSON file (exported from stocks_optimized.db)."""
        _load_profiles()

        try:
            is_valid, result = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"error": result, "success": False}), 400
            symbol = result

            cache_key = f"profile_{symbol}"
            cached = cache_get(cache_key)
            if cached:
                return jsonify(cached)

            profile_data = _company_profiles.get(symbol)
            if profile_data:
                company_profile_text = profile_data.get("company_profile") or ""
                history = profile_data.get("history") or ""
                industry = profile_data.get("icb_name3") or ""

                profile_result = {
                    "symbol": symbol,
                    "company_name": symbol,
                    "company_profile": company_profile_text or history,
                    "industry": industry,
                    "charter_capital": profile_data.get("charter_capital") or "",
                    "issue_share": profile_data.get("issue_share") or "",
                    "history": history[:300] + "..." if len(history) > 300 else history,
                    "success": True,
                }
                cache_set(cache_key, profile_result)
                return jsonify(profile_result)

            return jsonify({"success": False, "message": "No company data available"}), 404

        except Exception as exc:
            return jsonify({"success": False, "error": str(exc)}), 500
