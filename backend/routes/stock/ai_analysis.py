from __future__ import annotations

import logging
import sqlite3

from flask import Blueprint, jsonify

from backend.db_path import resolve_valuation_cache_db_path

logger = logging.getLogger(__name__)


def register(stock_bp: Blueprint) -> None:
    @stock_bp.route("/<symbol>/ai-analysis")
    def api_stock_ai_analysis(symbol: str):
        ticker = symbol.upper()
        db_path = resolve_valuation_cache_db_path()
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            row = conn.execute(
                """
                SELECT year_report, quarter_report, analysis_vi, analysis_json, model, generated_at
                FROM ai_financial_analysis
                WHERE ticker = ?
                ORDER BY year_report DESC, quarter_report DESC
                LIMIT 1
                """,
                (ticker,),
            ).fetchone()
            conn.close()

            if not row:
                return jsonify({"available": False}), 200

            year, q, analysis, analysis_json, model, generated_at = row
            return jsonify({
                "available": True,
                "ticker": ticker,
                "quarter": f"Q{q}.{year}",
                "year": year,
                "q": q,
                "analysis_vi": analysis,
                "analysis_json": analysis_json,
                "model": model,
                "generated_at": generated_at,
            })
        except Exception as e:
            logger.error(f"AI analysis fetch error for {ticker}: {e}")
            return jsonify({"available": False, "error": str(e)}), 500
