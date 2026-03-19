from __future__ import annotations

import logging

from flask import Blueprint, jsonify

from backend.data_sources.vci import VCIClient


logger = logging.getLogger(__name__)


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/vci-indices")
    def api_market_vci_indices():
        try:
            data = VCIClient.get_market_indices()
            resp = jsonify(data)
            resp.headers["Cache-Control"] = "no-store"
            return resp
        except Exception as e:
            logger.error(f"VCI indices proxy error: {e}")
            return jsonify([])
