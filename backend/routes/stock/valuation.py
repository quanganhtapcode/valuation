from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request
from backend.services.valuation_validation import ValuationInputError

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

            data = request.get_json(silent=True) if request.is_json else {}
            result = get_valuation_service().calculate(clean_symbol, data)
            return jsonify(result), (200 if result.get("success") else 404)
        except ValuationInputError as exc:
            return jsonify({'success': False, 'error': str(exc), 'field': exc.field}), 400
        except Exception as e:
            logger.error(f"Valuation error for {symbol}: {e}")
            return jsonify({"success": False, "error": str(e)}), 500


    @stock_bp.route("/valuation/<symbol>/sensitivity", methods=["GET", "POST"])
    def api_valuation_sensitivity(symbol: str):
        """Return DCF sensitivity matrix (WACC-growth grid)."""
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"success": False, "error": clean_symbol}), 400

        body: dict = {}
        if request.method == "POST":
            body = request.get_json(silent=True) if request.is_json else {}
        try:
            result = get_valuation_service().calculate_sensitivity(clean_symbol, body)
            return jsonify(result), (200 if result.get("success") else 404)
        except ValuationInputError as exc:
            return jsonify({'success': False, 'error': str(exc), 'field': exc.field}), 400
        except Exception as exc:
            logger.error(f"sensitivity endpoint error {clean_symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
