from __future__ import annotations

import logging
import math
import os

from backend.sqlite_utils import read_connection

from flask import Blueprint, jsonify, request

from .deps import cache_func, cache_ttl
from .paths import screener_db_path
from backend.data_sources.vci import VCIClient

logger = logging.getLogger(__name__)

_SECTOR_SHORTNAMES: dict[str, str] = {
    'Ngân hàng': 'Ngân hàng',
    'Bất động sản': 'BĐS',
    'Thực phẩm và đồ uống': 'Thực phẩm',
    'Dịch vụ tài chính': 'Tài chính',
    'Điện, nước & xăng dầu khí đốt': 'Điện & NL',
    'Du lịch và Giải trí': 'Du lịch',
    'Dầu khí': 'Dầu khí',
    'Hóa chất': 'Hóa chất',
    'Tài nguyên Cơ bản': 'Tài nguyên',
    'Hàng & Dịch vụ Công nghiệp': 'Công nghiệp',
    'Xây dựng và Vật liệu': 'Xây dựng',
    'Bán lẻ': 'Bán lẻ',
    'Công nghệ Thông tin': 'CNTT',
    'Bảo hiểm': 'Bảo hiểm',
    'Hàng cá nhân & Gia dụng': 'Tiêu dùng',
    'Viễn thông': 'Viễn thông',
    'Y tế': 'Y tế',
    'Tiện ích cộng đồng': 'Tiện ích',
}


def _positive_number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None


def resolve_quote(row, realtime):
    """Keep price/reference in one snapshot; never divide a DB price by a RAM ref."""
    price = _positive_number(realtime.get('c'))
    ref = _positive_number(realtime.get('ref'))
    if price is not None and ref is not None:
        return price, round((price / ref - 1) * 100, 4)
    # A reset/partial priceboard must not replace the last available daily snapshot.
    return float(row['marketPrice'] or 0), round(float(row['dailyPriceChangePercent'] or 0), 4)


def fetch_heatmap(exchange: str, limit: int):
    db = screener_db_path()
    if not db or not os.path.exists(db):
        return {'sectors': []}

    with read_connection(db) as conn:
        rows = conn.execute(
            'SELECT ticker, viSector, marketCap, dailyPriceChangePercent, marketPrice, '
            'viOrganShortName, enOrganShortName '
            'FROM screening_data '
            'WHERE exchange = ? AND marketCap > 0 AND viSector IS NOT NULL '
            'ORDER BY marketCap DESC LIMIT ?',
            (exchange, limit),
        ).fetchall()

    # Outside market hours retain the daily snapshot, including its daily change.
    VCIClient.ensure_background_refresh()
    realtime_cache = VCIClient.get_all_prices() if VCIClient._is_trading_hours() else {}

    sector_map: dict[str, list] = {}
    for r in rows:
        ticker = r['ticker']
        s = r['viSector'] or 'Khác'

        rt_item = realtime_cache.get(ticker, {})
        price, change = resolve_quote(r, rt_item)

        name = r['viOrganShortName'] or r['enOrganShortName'] or ticker
        if s not in sector_map:
            sector_map[s] = []
        sector_map[s].append({
            'ticker': ticker,
            'cap': r['marketCap'],
            'change': change,
            'price': price,
            'name': name,
            'sector': s,
        })

    sectors = []
    for name, stocks in sector_map.items():
        total_cap = sum(s['cap'] for s in stocks)
        avg_change = (
            sum(s['change'] * s['cap'] for s in stocks) / total_cap
            if total_cap > 0 else 0
        )
        sectors.append({
            'name': name,
            'shortName': _SECTOR_SHORTNAMES.get(name, name[:6]),
            'totalCap': total_cap,
            'avgChange': round(avg_change, 4),
            'stocks': sorted(stocks, key=lambda x: x['cap'], reverse=True),
        })

    sectors.sort(key=lambda x: x['totalCap'], reverse=True)
    return {'sectors': sectors}


def register(market_bp: Blueprint) -> None:
    @market_bp.route('/heatmap', methods=['GET'])
    def api_market_heatmap():
        """Stock heatmap grouped by sector, sized by screener market cap."""
        exchange = (request.args.get('exchange', 'HSX') or 'HSX').upper()
        if exchange == 'HOSE':
            exchange = 'HSX'
        if exchange not in {'HSX', 'HNX', 'UPCOM'}:
            return jsonify({'error': 'Invalid exchange'}), 400
        try:
            limit = max(1, min(int(request.args.get('limit', '150')), 300))
        except (TypeError, ValueError):
            return jsonify({'error': 'Invalid limit'}), 400
        cache_key = f'heatmap_{exchange}_{limit}'
        try:
            data, _ = cache_func()(
                cache_key, cache_ttl().get('realtime', 45),
                lambda: fetch_heatmap(exchange, limit),
            )
            return jsonify(data)
        except Exception as e:
            logger.error(f'heatmap error: {e}')
            return jsonify({'sectors': []})
