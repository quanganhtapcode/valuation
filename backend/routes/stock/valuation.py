from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from backend.extensions import get_valuation_service
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/valuation/<symbol>", methods=["POST"])
    def api_valuation(symbol):
        """Calculate valuation using the unified 6-model ValuationService."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            data = request.get_json(silent=True) or {}
            result = get_valuation_service().calculate(clean_symbol, data)
            return jsonify(result), (200 if result.get("success") else 404)
        except Exception as e:
            logger.error(f"Valuation error for {symbol}: {e}")
            return jsonify({"success": False, "error": str(e)}), 500
