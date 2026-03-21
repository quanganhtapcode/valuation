from flask import Blueprint, jsonify, request
import logging
from backend.extensions import get_valuation_service
from backend.utils import validate_stock_symbol

valuation_bp = Blueprint('valuation', __name__, url_prefix='/api/valuation')
logger = logging.getLogger(__name__)

@valuation_bp.route("/<symbol>", methods=['GET', 'POST'])
def calculate_valuation(symbol):
    try:
        logger.info(f"Calculating valuation for {symbol} via ValuationService")
        is_valid, clean_symbol = validate_stock_symbol(symbol)
        if not is_valid:
            return jsonify({"success": False, "error": clean_symbol}), 400

        request_data = {} if request.method == 'GET' else (request.get_json(silent=True) or {})
        result = get_valuation_service().calculate(clean_symbol, request_data)
        return jsonify(result), (200 if result.get('success') else 404)
    except Exception as exc:
        logger.error(f"Valuation calculation error for {symbol}: {exc}")
        return jsonify({
            "success": False,
            "error": str(exc),
            "symbol": symbol.upper()
        }), 500
