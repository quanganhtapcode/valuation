"""Company catalogue, search and ticker metadata."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from flask import Blueprint, jsonify, request
from backend.db_path import resolve_vci_company_db_path, resolve_vci_screening_db_path
from backend.extensions import get_stock_service
from .cache import _cache_get, _cache_set

logger = logging.getLogger(__name__)

def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/companies")
    def api_companies():
        """Return all companies, optionally filtered by exchange."""
        exchange = request.args.get("exchange", "").upper()
        try:
            page = max(1, int(request.args.get("page", 1)))
            limit = min(500, max(10, int(request.args.get("limit", 200))))
        except ValueError:
            return jsonify({"error": "page and limit must be integers"}), 400

        cache_key = f"companies_{exchange}_{page}_{limit}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return jsonify(cached)

        try:
            result = get_stock_service().list_companies(exchange, page, limit)
            _cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error(f"GET /companies error: {exc}")
            return jsonify({"error": str(exc)}), 500

    @stock_bp.route("/companies/search")
    def api_companies_search():
        """Search companies by ticker or name."""
        q = request.args.get("q", "").strip()
        try:
            limit = min(50, max(1, int(request.args.get("limit", 20))))
        except ValueError:
            return jsonify({"error": "limit must be an integer"}), 400
        if not q:
            return jsonify([])

        cache_key = f"co_search_{q.lower()}_{limit}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return jsonify(cached)

        try:
            stock_service = get_stock_service()
            results = stock_service.search_stocks(q, limit)
            _cache_set(cache_key, results)
            return jsonify(results)
        except Exception as exc:
            logger.error(f"GET /companies/search error: {exc}")
            return jsonify({"error": str(exc)}), 500

    @stock_bp.route("/companies/industry/<path:industry>")
    def api_companies_by_industry(industry: str):
        """Return stocks belonging to an industry (ICB level-3 or level-4)."""
        cache_key = f"co_industry_{industry.lower()}"
        cached = _cache_get(cache_key)
        if cached is not None:
            return jsonify(cached)

        company_path = resolve_vci_company_db_path()
        screening_path = resolve_vci_screening_db_path()
        try:
            conn = sqlite3.connect(company_path)
            conn.row_factory = sqlite3.Row
            conn.execute(f"ATTACH DATABASE '{screening_path}' AS scr")
            cur = conn.cursor()

            cur.execute(
                """
                SELECT c.ticker AS symbol, c.organ_name AS name,
                       COALESCE(sc.exchange, c.floor, 'HOSE') AS exchange,
                       COALESCE(sc.viSector, c.icb_name4, c.icb_name3, '') AS industry
                FROM companies c
                LEFT JOIN scr.screening_data sc ON UPPER(sc.ticker) = UPPER(c.ticker)
                WHERE COALESCE(sc.enSector, c.icb_name3, '') = ?
                ORDER BY c.ticker
                """,
                (industry,),
            )
            rows = cur.fetchall()
            conn.close()

            result = [dict(r) for r in rows]
            _cache_set(cache_key, result)
            return jsonify(result)
        except Exception as exc:
            logger.error(f"GET /companies/industry error: {exc}")
            return jsonify({"error": str(exc)}), 500

    @stock_bp.route("/tickers")
    def api_tickers():
        """Serve the latest ticker_data.json content."""
        try:
            root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            ticker_file = os.path.join(root_dir, "frontend-next", "public", "ticker_data.json")
            if not os.path.exists(ticker_file):
                ticker_file = os.path.join(root_dir, "frontend", "ticker_data.json")
            if not os.path.exists(ticker_file):
                return jsonify({"error": "ticker_data.json not found"}), 503
            with open(ticker_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            return jsonify(data)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
