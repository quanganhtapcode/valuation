from __future__ import annotations

import logging
from datetime import datetime

import pandas as pd
from flask import Blueprint, jsonify, request

from backend.extensions import get_provider
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/price/<symbol>")
    def api_price(symbol):
        """Get real-time price for a symbol (lightweight endpoint for auto-refresh)."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            symbol = clean_symbol
            provider = get_provider()

            cached_data = provider._stock_data_cache.get(symbol, {})
            shares = cached_data.get("shares_outstanding")

            price_data = provider.get_current_price_with_change(symbol)
            if price_data:
                current_price = price_data.get("current_price", 0)
                market_cap = current_price * shares if pd.notna(shares) and shares > 0 else None
                return jsonify(
                    {
                        "symbol": symbol,
                        "current_price": current_price,
                        "price_change": price_data.get("price_change"),
                        "price_change_percent": price_data.get("price_change_percent"),
                        "timestamp": datetime.now().isoformat(),
                        "success": True,
                        "source": price_data.get("source", "VCI"),
                        "open": price_data.get("open", 0),
                        "high": price_data.get("high", 0),
                        "low": price_data.get("low", 0),
                        "volume": price_data.get("volume", 0),
                        "ceiling": price_data.get("ceiling", 0),
                        "floor": price_data.get("floor", 0),
                        "ref_price": price_data.get("ref_price", 0),
                        "market_cap": market_cap,
                        "shares_outstanding": shares,
                    }
                )

            return jsonify({"success": False, "error": f"Could not fetch price for {symbol}", "symbol": symbol}), 404
        except Exception as exc:
            logger.error(f"API /price error {symbol}: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500

    @stock_bp.route("/current-price/<symbol>")
    @stock_bp.route("/stock/<symbol>/current-price")
    def api_current_price(symbol):
        """Get real-time current price for a symbol (dict format)."""
        return api_price(symbol)

    @stock_bp.route("/stock/batch-price")
    @stock_bp.route("/batch-price")
    def api_batch_price():
        """Get real-time prices for multiple symbols at once."""
        provider = get_provider()
        try:
            symbols_param = request.args.get("symbols", "")
            if not symbols_param:
                return jsonify({"error": "Missing 'symbols' parameter"}), 400

            symbols = [s.strip().upper() for s in symbols_param.split(",") if s.strip()]
            if len(symbols) > 20:
                symbols = symbols[:20]

            result = {}
            for sym in symbols:
                try:
                    price_data = provider.get_current_price_with_change(sym)
                    cached_data = provider._stock_data_cache.get(sym, {})
                    company_name = cached_data.get("company_name") or cached_data.get("short_name") or sym
                    exchange = cached_data.get("exchange", "HOSE")
                    if price_data:
                        current_price = price_data.get("current_price")
                        change_percent = price_data.get("price_change_percent", 0)
                    else:
                        current_price = None
                        change_percent = 0
                    result[sym] = {
                        "price": current_price,
                        "changePercent": change_percent,
                        "companyName": company_name,
                        "exchange": exchange,
                    }
                except Exception as e:
                    logger.warning(f"Error getting data for {sym}: {e}")
                    result[sym] = {"price": None, "changePercent": 0, "companyName": sym, "exchange": "HOSE"}

            return jsonify(result)
        except Exception as exc:
            logger.error(f"API /stock/batch-price error: {exc}")
            return jsonify({"success": False, "error": str(exc)}), 500
