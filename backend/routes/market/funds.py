from flask import jsonify
from backend.fund_snapshot import read_snapshot


def register(market_bp):
    @market_bp.route("/funds", methods=["GET"])
    def get_fund_prices():
        result = read_snapshot()
        response = jsonify(result)
        response.headers["Cache-Control"] = "public, max-age=60" if result.get("success") else "no-store"
        return response, 200 if result.get("success") else 503
