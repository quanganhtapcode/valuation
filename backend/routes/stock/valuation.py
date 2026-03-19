from __future__ import annotations

import logging

import pandas as pd
from flask import Blueprint, jsonify, request

from backend.extensions import get_provider
from backend.utils import validate_stock_symbol


logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/valuation/<symbol>", methods=["POST"])
    def api_valuation(symbol):
        """Calculate valuation based on assumptions (supports frontend UI)."""
        try:
            is_valid, clean_symbol = validate_stock_symbol(symbol)
            if not is_valid:
                return jsonify({"success": False, "error": clean_symbol}), 400

            data = request.get_json(silent=True) or {}

            def to_float(value, default=0.0):
                try:
                    if value is None or pd.isna(value):
                        return default
                    return float(value)
                except Exception:
                    return default

            provider = get_provider()
            stock_data = provider.get_stock_data(clean_symbol, period="quarter")
            if not stock_data or not stock_data.get("success"):
                stock_data = provider.get_stock_data(clean_symbol, period="year")

            current_price = to_float(data.get("currentPrice"), 0.0)
            if current_price <= 0:
                current_price = to_float(stock_data.get("current_price"), 0.0)

            eps = to_float(stock_data.get("eps_ttm"))
            if eps <= 0:
                eps = to_float(stock_data.get("eps"))
            if eps <= 0:
                eps = to_float(stock_data.get("earnings_per_share"))

            bvps = to_float(stock_data.get("bvps"))
            if bvps <= 0:
                bvps = to_float(stock_data.get("book_value_per_share"))
            if bvps <= 0:
                total_equity = to_float(stock_data.get("total_equity"))
                shares_outstanding = to_float(stock_data.get("shares_outstanding"))
                if total_equity > 0 and shares_outstanding > 0:
                    bvps = total_equity / shares_outstanding

            peers = provider.get_stock_peers(clean_symbol) or []
            peer_pe_values = []
            peer_pb_values = []
            for peer in peers:
                pe_val = to_float(peer.get("pe"))
                pb_val = to_float(peer.get("pb"))
                if 0 < pe_val <= 80:
                    peer_pe_values.append(pe_val)
                if 0 < pb_val <= 20:
                    peer_pb_values.append(pb_val)

            peer_pe = 15.0
            if peer_pe_values:
                peer_pe_values.sort()
                peer_pe = peer_pe_values[len(peer_pe_values) // 2]

            peer_pb = 1.5
            if peer_pb_values:
                peer_pb_values.sort()
                peer_pb = peer_pb_values[len(peer_pb_values) // 2]

            graham = 0.0
            if eps > 0 and bvps > 0:
                graham = float((22.5 * eps * bvps) ** 0.5)

            justified_pe = float(eps * peer_pe) if eps > 0 else 0.0
            justified_pb = float(bvps * peer_pb) if bvps > 0 else 0.0

            growth = to_float(data.get("revenueGrowth"), 8.0) / 100
            dcf_base = current_price if current_price > 0 else max(justified_pe, justified_pb, graham, 0)
            dcf_value = float(dcf_base * (1 + growth)) if dcf_base > 0 else 0.0

            valuations = {
                "fcfe": dcf_value,
                "fcff": dcf_value * 0.95,
                "justified_pe": justified_pe,
                "justified_pb": justified_pb,
                "graham": graham,
            }

            weights = data.get("modelWeights", {}) or {}
            if not any(to_float(w) > 0 for w in weights.values()):
                weights = {"fcfe": 20, "fcff": 20, "justified_pe": 20, "justified_pb": 20, "graham": 20}

            total_val = 0.0
            total_weight = 0.0
            for key, weight in weights.items():
                val = to_float(valuations.get(key))
                w = to_float(weight)
                if val > 0 and w > 0:
                    total_val += val * w
                    total_weight += w

            weighted_avg = (total_val / total_weight) if total_weight > 0 else 0.0
            valuations["weighted_average"] = weighted_avg

            return jsonify(
                {
                    "success": True,
                    "valuations": valuations,
                    "symbol": clean_symbol,
                    "inputs": {
                        "current_price": current_price,
                        "eps_ttm": eps,
                        "bvps": bvps,
                        "peer_pe_used": peer_pe,
                        "peer_pb_used": peer_pb,
                        "peer_count": len(peers),
                    },
                }
            )
        except Exception as e:
            logger.error(f"Valuation error for {symbol}: {e}")
            return jsonify({"success": False, "error": str(e)}), 500
