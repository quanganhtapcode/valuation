from flask import jsonify
from backend.fund_snapshot import read_snapshot
from backend.fund_store import fund_detail


def register(market_bp):
    @market_bp.route("/funds", methods=["GET"])
    def get_fund_prices():
        result = read_snapshot()
        response = jsonify(result)
        response.headers["Cache-Control"] = "public, max-age=60" if result.get("success") else "no-store"
        return response, 200 if result.get("success") else 503

    @market_bp.route('/funds/<symbol>', methods=['GET'])
    def get_fund_detail(symbol):
        result = fund_detail(symbol)
        if result is None:
            return jsonify({'success': False, 'error': 'Fund not found'}), 404
        response = jsonify(result)
        response.headers['Cache-Control'] = 'public, max-age=60'
        return response
