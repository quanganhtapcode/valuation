from __future__ import annotations

import logging

import requests as http_requests
from flask import Blueprint, jsonify, request

from backend.routes.handlers.lottery_rss import parse_lottery_rss
from .deps import cache_func


logger = logging.getLogger(__name__)


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/lottery", methods=["GET"])
    def get_lottery_results():
        region = request.args.get("region", "mb")

        rss_map = {
            "mb": "https://xosodaiphat.com/ket-qua-xo-so-mien-bac-xsmb.rss",
            "mn": "https://xosodaiphat.com/ket-qua-xo-so-mien-nam-xsmn.rss",
            "mt": "https://xosodaiphat.com/ket-qua-xo-so-mien-trung-xsmt.rss",
        }

        url = rss_map.get(region, rss_map["mb"])
        cache_key = f"lottery_{region}"

        def fetch_rss():
            response = http_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            response.raise_for_status()
            return parse_lottery_rss(content=response.content, region=region)

        data, _ = cache_func()(cache_key, 300, fetch_rss)
        return jsonify(data)
