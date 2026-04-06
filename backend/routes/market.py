"""
Market Routes Blueprint
Handles all /api/market/* endpoints
Proxies CafeF, BTMC, and lottery data with server-side caching
"""

from flask import Blueprint, jsonify, request
import requests as http_requests
import re
import xml.etree.ElementTree as ET
import logging
import time
import sqlite3
import os
from datetime import date, datetime
from pathlib import Path
from backend.data_sources.vci import VCIClient
from backend.db_path import resolve_vci_screening_db_path
from backend.services.news_service import NewsService
from backend.services.vci_news_sqlite import default_news_db_path, is_fresh, query_market_news
from backend.services.vci_standouts_sqlite import default_standouts_db_path, is_fresh as is_standouts_fresh, read_ticker_info

from backend.routes.handlers.vci_top_movers import top_movers_from_screener_sqlite
from backend.routes.handlers.vci_standouts import standouts_join_with_screener, fetch_standouts_upstream
from backend.routes.handlers.index_history import resolve_index_db_path, read_index_history
from backend.routes.handlers.lottery_rss import parse_lottery_rss

logger = logging.getLogger(__name__)


_INDEX_ID_TO_VCI_SYMBOL = {
    '1': 'VNINDEX',
    '2': 'HNXIndex',
    '9': 'HNXUpcomIndex',
    '11': 'VN30',
}


def _find_vci_index_item(vci_symbol: str) -> dict | None:
    try:
        items = VCIClient.get_market_indices() or []
    except Exception:
        return None
    vci_symbol_u = str(vci_symbol).upper()
    for it in items:
        try:
            if str(it.get('symbol') or '').upper() == vci_symbol_u:
                return it
        except Exception:
            continue
    return None

def _get_screener_db():
    return resolve_vci_screening_db_path()


# Create blueprint
market_bp = Blueprint('market', __name__, url_prefix='/api/market')

# These will be set by init_market_routes()
_cache_func = None
_cache_ttl = None
_gold_service = None


def init_market_routes(get_cached_func, cache_ttl, gold_service):
    """Initialize market routes with dependencies"""
    global _cache_func, _cache_ttl, _gold_service
    _cache_func = get_cached_func
    _cache_ttl = cache_ttl
    _gold_service = gold_service


# ===================== GOLD PRICE =====================

@market_bp.route('/gold', methods=['GET'])
def get_gold_price():
    """Get gold and silver prices from BTMC - uses GoldService"""
    data, _ = _cache_func(
        'gold_price_btmc',
        60,
        _gold_service.fetch_with_retry,
        should_cache_func=_gold_service.validate_response
    )
    return jsonify(data)


# ===================== CAFEF PROXY ENDPOINTS =====================

_CAFEF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Referer': 'https://cafef.vn/',
}

_VCI_HEADERS = {
    'accept': 'application/json',
    'accept-language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'origin': 'https://trading.vietcap.com.vn',
    'referer': 'https://trading.vietcap.com.vn/'
}

_VALUATION_SQLITE = Path(__file__).resolve().parents[2] / "fetch_sqlite" / "vci_valuation.sqlite"


def _normalize_metric(metric: str | None) -> str:
    value = str(metric or "both").strip().lower()
    if value in {"pe", "pb", "both"}:
        return value
    return "both"


def _apply_time_frame(
    series: list[dict],
    time_frame: str,
) -> list[dict]:
    frame = str(time_frame or "ALL").strip().upper()
    if frame in {"", "ALL"}:
        return series

    today = date.today()
    if frame == "YTD":
        cutoff = date(today.year, 1, 1)
    elif frame == "6M":
        month = today.month - 6
        year = today.year
        while month <= 0:
            month += 12
            year -= 1
        cutoff = date(year, month, today.day if today.day <= 28 else 28)
    elif frame == "1Y":
        cutoff = date(today.year - 1, today.month, today.day if today.day <= 28 else 28)
    elif frame == "2Y":
        cutoff = date(today.year - 2, today.month, today.day if today.day <= 28 else 28)
    elif frame == "5Y":
        cutoff = date(today.year - 5, today.month, today.day if today.day <= 28 else 28)
    else:
        return series

    out: list[dict] = []
    for item in series:
        date_str = str(item.get("date") or "").strip()
        if not date_str:
            continue
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d").date()
        except Exception:
            continue
        if d >= cutoff:
            out.append(item)
    return out


def _attach_ema50(vnindex_series: list[dict], period: int = 50) -> list[dict]:
    if not vnindex_series:
        return vnindex_series

    multiplier = 2 / (period + 1)
    ema: float | None = None
    warmup: list[float] = []

    for item in vnindex_series:
        if item.get("ema50") is not None:
            try:
                ema = float(item["ema50"])
            except (TypeError, ValueError):
                ema = None
            continue

        raw_price = item.get("close")
        if raw_price is None:
            raw_price = item.get("value")
        if raw_price is None:
            item["ema50"] = None
            continue

        try:
            price = float(raw_price)
        except (TypeError, ValueError):
            item["ema50"] = None
            continue

        if ema is None:
            warmup.append(price)
            if len(warmup) < period:
                item["ema50"] = None
                continue
            ema = sum(warmup[-period:]) / period
        else:
            ema = (price - ema) * multiplier + ema

        item["ema50"] = float(ema)

    return vnindex_series


def _read_vci_valuation_sqlite() -> dict | None:
    if not _VALUATION_SQLITE.exists():
        return None
    try:
        with sqlite3.connect(str(_VALUATION_SQLITE)) as conn:
            conn.row_factory = sqlite3.Row
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(valuation_history)").fetchall()}
            has_extended = {"open", "high", "low", "close", "accumulated_volume", "accumulated_value"}.issubset(columns)
            has_ema50 = "ema50" in columns
            if has_extended:
                select_cols = (
                    "date, pe, pb, vnindex, open, high, low, close, volume, "
                    "accumulated_volume, accumulated_value"
                )
                if has_ema50:
                    select_cols = (
                        "date, pe, pb, vnindex, open, high, low, close, ema50, volume, "
                        "accumulated_volume, accumulated_value"
                    )
                rows = conn.execute(f"SELECT {select_cols} FROM valuation_history ORDER BY date").fetchall()
            else:
                rows = conn.execute("SELECT date, pe, pb, vnindex, volume FROM valuation_history ORDER BY date").fetchall()

            if not rows:
                return None

            try:
                stat_rows = conn.execute(
                    "SELECT metric, average, plus_one_sd, plus_two_sd, minus_one_sd, minus_two_sd FROM valuation_stats"
                ).fetchall()
            except Exception:
                stat_rows = []

        pe_series: list[dict] = []
        pb_series: list[dict] = []
        vnindex_series: list[dict] = []

        for r in rows:
            if r["pe"] is not None:
                pe_series.append({"date": r["date"], "value": r["pe"]})
            if r["pb"] is not None:
                pb_series.append({"date": r["date"], "value": r["pb"]})
            if r["vnindex"] is not None:
                item = {"date": r["date"], "value": r["vnindex"], "volume": r["volume"]}
                if "open" in r.keys():
                    item["open"] = r["open"]
                    item["high"] = r["high"]
                    item["low"] = r["low"]
                    item["close"] = r["close"]
                    if "ema50" in r.keys():
                        item["ema50"] = r["ema50"]
                    item["accumulated_volume"] = r["accumulated_volume"]
                    item["accumulated_value"] = r["accumulated_value"]
                vnindex_series.append(item)

        stats = {}
        for sr in stat_rows:
            stats[sr["metric"]] = {
                "average": sr["average"],
                "plusOneSD": sr["plus_one_sd"],
                "plusTwoSD": sr["plus_two_sd"],
                "minusOneSD": sr["minus_one_sd"],
                "minusTwoSD": sr["minus_two_sd"],
            }

        return {
            "pe": pe_series,
            "pb": pb_series,
            "vnindex": _attach_ema50(vnindex_series),
            "stats": stats,
        }
    except Exception as exc:
        logger.warning(f"Failed to read valuation sqlite: {exc}")
        return None


def _read_ema_breadth_sqlite(limit: int = 260) -> list[dict]:
    if not _VALUATION_SQLITE.exists():
        return []
    try:
        with sqlite3.connect(str(_VALUATION_SQLITE)) as conn:
            conn.row_factory = sqlite3.Row
            table_exists = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ema_breadth_history'"
            ).fetchone()
            if not table_exists:
                return []

            rows = conn.execute(
                "SELECT trading_date, above_count, total_count, above_percent "
                "FROM ema_breadth_history ORDER BY trading_date DESC LIMIT ?",
                (max(30, min(limit, 4000)),),
            ).fetchall()

        out = []
        for r in reversed(rows):
            above = int(r["above_count"] or 0)
            total = int(r["total_count"] or 0)
            below = max(0, total - above)
            percent = float(r["above_percent"]) if r["above_percent"] is not None else (above / total if total > 0 else 0.0)
            out.append(
                {
                    "date": r["trading_date"],
                    "aboveEma50": above,
                    "belowEma50": below,
                    "total": total,
                    "abovePercent": percent,
                }
            )
        return out
    except Exception as exc:
        logger.warning(f"Failed to read ema breadth sqlite: {exc}")
        return []




@market_bp.route('/prices')
def api_market_prices():
    """
    Return bulk price data from the VCI RAM cache (background-refreshed every 12s).
    Returns a flat dict { SYMBOL: { price, change, changePercent } } for all ~1500 tickers.
    Zero latency - reads directly from RAM, no external API call.
    Optionally filter by ?symbols=FPT,SSI,VNM (comma-separated).
    """
    VCIClient.ensure_background_refresh()
    cache = VCIClient._price_cache  # raw dict {SYMBOL: raw_item}

    symbols_param = request.args.get('symbols', '')
    filter_set = set(s.strip().upper() for s in symbols_param.split(',') if s.strip()) if symbols_param else None

    result = {}
    for sym, item in cache.items():
        if filter_set and sym not in filter_set:
            continue
        price = float(item.get('c') or item.get('ref') or 0)
        ref = float(item.get('ref') or 0)
        change = round(price - ref, 2) if ref > 0 else 0
        change_pct = round((change / ref) * 100, 2) if ref > 0 else 0
        result[sym] = {
            'price': price,
            'change': change,
            'changePercent': change_pct,
        }

    return jsonify(result)


@market_bp.route('/realtime')
def api_market_realtime():
    return jsonify({"success": False, "error": "Deprecated: use /api/market/vci-indices"}), 410


@market_bp.route('/pe-chart')
def api_market_pe_chart():
    """Index valuation chart from SQLite (PE/PB/VNINDEX + EMA50), fallback CafeF."""
    metric = _normalize_metric(request.args.get("metric", "both"))
    index = (request.args.get("index") or "VNINDEX").strip().upper()
    time_frame = (request.args.get("timeFrame") or request.args.get("time_frame") or "ALL").strip().upper()
    cache_key = f"pe_chart_{index}_{time_frame}_{metric}"

    def fetch_pe_chart():
        if index == "VNINDEX":
            sqlite_data = _read_vci_valuation_sqlite()
            if sqlite_data:
                pe_series = _apply_time_frame(sqlite_data.get("pe") or [], time_frame)
                pb_series = _apply_time_frame(sqlite_data.get("pb") or [], time_frame)
                vnindex_series = _apply_time_frame(sqlite_data.get("vnindex") or [], time_frame)
                selected_data = pe_series if metric == "pe" else (pb_series if metric == "pb" else pe_series)
                return {
                    "success": True,
                    "source": "SQLite",
                    "index": index,
                    "timeFrame": time_frame,
                    "metric": metric,
                    "series": {"pe": pe_series, "pb": pb_series, "vnindex": vnindex_series},
                    "stats": sqlite_data.get("stats") or {},
                    "pe": pe_series,
                    "pb": pb_series,
                    "Data": selected_data,
                    "DataPE": pe_series,
                    "DataPB": pb_series,
                }

        # Legacy fallback
        url = "https://cafef.vn/du-lieu/Ajax/PageNew/FinanceData/GetDataChartPE.ashx"
        response = http_requests.get(url, timeout=15, headers=_CAFEF_HEADERS)
        response.raise_for_status()
        return response.json()

    try:
        data, is_cached = _cache_func(cache_key, _cache_ttl.get('pe_chart', 3600), fetch_pe_chart)
        response = jsonify(data)
        response.headers['X-Cache'] = 'HIT' if is_cached else 'MISS'
        return response
    except Exception as e:
        logger.error(f"PE chart proxy error: {e}")
        return jsonify({"error": str(e)}), 500


@market_bp.route('/ema50-breadth')
def api_market_ema50_breadth():
    """Market breadth: number of stocks above/below EMA50 from SQLite snapshot."""
    try:
        days = int(request.args.get("days", "260"))
    except Exception:
        days = 260
    days = max(30, min(days, 4000))

    cache_key = f"ema50_breadth_{days}"

    def fetch_breadth():
        series = _read_ema_breadth_sqlite(limit=days)
        if not series:
            return {"success": False, "data": []}
        latest = series[-1]
        return {
            "success": True,
            "source": "SQLite",
            "condition": "EMA50",
            "data": series,
            "latest": latest,
        }

    try:
        data, is_cached = _cache_func(cache_key, _cache_ttl.get('pe_chart', 3600), fetch_breadth)
        response = jsonify(data)
        response.headers['X-Cache'] = 'HIT' if is_cached else 'MISS'
        return response
    except Exception as e:
        logger.error(f"EMA50 breadth error: {e}")
        return jsonify({"success": False, "data": []}), 500


@market_bp.route('/news')
def api_market_news():
    """VCI AI market news (prefer SQLite cache, fallback to upstream)"""
    page_index = request.args.get("page", "1")
    page_size = request.args.get("size", "12")
    try:
        page_size = str(min(int(page_size), 50))
    except ValueError:
        page_size = "12"

    # Prefer SQLite cache produced by fetch_sqlite/fetch_vci_news.py
    try:
        news_db = default_news_db_path()
        if is_fresh(news_db, max_age_seconds=_cache_ttl.get('news', 300) if _cache_ttl else 300):
            data = query_market_news(news_db, page=int(page_index), page_size=int(page_size))
            response = jsonify({"data": data})
            response.headers['X-Cache'] = 'SQLITE'
            return response
    except Exception as e:
        logger.warning(f"SQLite news read failed; falling back to upstream: {e}")

    cache_key = f"news_vci_ai_upstream_{page_index}_{page_size}"

    def fetch_news():
        return NewsService.fetch_news(ticker="", page=int(page_index), page_size=int(page_size))

    try:
        data, is_cached = _cache_func(cache_key, _cache_ttl.get('news', 300), fetch_news)
        response = jsonify({"data": data} if isinstance(data, list) else data)
        response.headers['X-Cache'] = 'HIT' if is_cached else 'MISS'
        return response
    except Exception as e:
        logger.error(f"News proxy error: {e}")
        return jsonify([])


@market_bp.route('/reports')
def api_market_reports():
    return jsonify({"success": False, "error": "Deprecated"}), 410


@market_bp.route('/indices')
def api_market_indices():
    return jsonify({"success": False, "error": "Deprecated: use /api/market/vci-indices"}), 410


@market_bp.route('/index-history')
def api_market_index_history():
    """Return index history from SQLite cache if present.

    Query params:
    - index: e.g. VNINDEX, VN30, HNXIndex, HNXUpcomIndex
    - days: number of rows to return (default 90, max 2000)
    """
    index = (request.args.get('index') or '').strip()
    if not index:
        return jsonify([])

    days_raw = request.args.get('days', '90')
    try:
        days = int(days_raw)
    except Exception:
        days = 90
    days = max(1, min(days, 2000))

    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    db_path = resolve_index_db_path(base_dir=base_dir, index=index)
    if not db_path:
        response = jsonify([])
        response.headers['X-Source'] = 'NONE'
        return response

    try:
        rows = read_index_history(db_path=db_path, days=days, index=index)
        response = jsonify(rows)
        response.headers['X-Source'] = 'SQLITE'
        response.headers['X-DB'] = os.path.basename(db_path)
        return response
    except Exception as exc:
        logger.warning(f"index-history read failed for {index}: {exc}")
        response = jsonify([])
        response.headers['X-Source'] = 'ERROR'
        return response


@market_bp.route('/top-movers')
def api_market_top_movers():
    """VCI Top 10 stocks (UP/DOWN) for HSX from realtime RAM + SQLite names."""
    move_type = request.args.get("type", "UP")
    cache_key = f"top_movers_vci_hsx_{move_type}_realtime"
    top_movers_ttl = max(1, int(os.getenv("TOP_MOVERS_CACHE_SECONDS", "3")))

    def fetch_top_movers():
        return top_movers_from_screener_sqlite(db_path=_get_screener_db(), move_type=move_type, exchange="HSX", limit=10)

    try:
        data, is_cached = _cache_func(cache_key, top_movers_ttl, fetch_top_movers)
        response = jsonify(data)
        response.headers['X-Cache'] = 'HIT' if is_cached else 'MISS'
        response.headers['X-Source'] = 'VCI_RAM+SQLITE'
        response.headers['X-DB'] = 'fetch_sqlite/vci_screening.sqlite'
        return response
    except Exception as e:
        logger.error(f"Top movers proxy error: {e}")
        return jsonify({"Data": [], "Success": False})


@market_bp.route('/standouts')
def api_market_standouts():
    """VCI Standouts from AI (prefer SQLite cache, refresh hourly) + vci_screening.sqlite join"""
    cache_key = "standouts_vci_hsx_ai_sqlite"

    def fetch_standouts():
        db_path = _get_screener_db()
        if not os.path.exists(db_path):
            return []

        # Prefer hourly SQLite snapshot for standouts (no per-request upstream call)
        try:
            standouts_db = default_standouts_db_path()
            if is_standouts_fresh(standouts_db, max_age_seconds=3600):
                ticker_info = read_ticker_info(standouts_db)
            else:
                ticker_info = []
        except Exception as e:
            logger.warning(f"SQLite standouts read failed; falling back to upstream: {e}")
            ticker_info = []
            
        # Fallback upstream when snapshot missing/stale
        if not ticker_info:
            ticker_info = fetch_standouts_upstream(http_get=http_requests.get, timeout_s=10)

        if not ticker_info:
            return []

        return standouts_join_with_screener(screener_db_path=db_path, ticker_info=ticker_info, max_positive=5)

    try:
        data, is_cached = _cache_func(cache_key, _cache_ttl.get('basic', 300), fetch_standouts)
        response = jsonify(data)
        response.headers['X-Cache'] = 'HIT' if is_cached else 'MISS'
        return response
    except Exception as e:
        logger.error(f"Standouts proxy error: {e}")
        return jsonify([])


@market_bp.route('/foreign-flow')
def api_market_foreign_flow():
    """Proxy for CafeF Foreign investor buy/sell - CACHED 45s"""
    flow_type = request.args.get("type", "buy")
    cache_key = f"foreign_flow_{flow_type}"

    def fetch_foreign_flow():
        url = f"https://cafef.vn/du-lieu/ajax/mobile/smart/ajaxkhoingoai.ashx?type={flow_type}"
        response = http_requests.get(url, timeout=10, headers=_CAFEF_HEADERS)
        response.raise_for_status()
        return response.json()

    try:
        data, is_cached = _cache_func(cache_key, _cache_ttl.get('realtime', 45), fetch_foreign_flow)
        response = jsonify(data)
        response.headers['X-Cache'] = 'HIT' if is_cached else 'MISS'
        return response
    except Exception as e:
        logger.error(f"Foreign flow proxy error: {e}")
        return jsonify({"Data": [], "Success": False})


@market_bp.route('/realtime-chart')
def api_market_realtime_chart():
    return jsonify({"success": False, "error": "Deprecated"}), 410


@market_bp.route('/realtime-market')
def api_market_realtime_market():
    return jsonify({"success": False, "error": "Deprecated"}), 410


@market_bp.route('/vci-indices')
def api_market_vci_indices():
    """Return market indices from RAM - blazing fast, background thread keeps it fresh"""
    start = time.perf_counter()
    try:
        data = VCIClient.get_market_indices()
        response = jsonify(data)
        response.headers['Cache-Control'] = 'no-store'
        dur_ms = (time.perf_counter() - start) * 1000.0
        response.headers['Server-Timing'] = f"vci_indices;dur={dur_ms:.2f}"
        response.headers['X-Source'] = f"VCI_RAM_{VCIClient.get_indices_source()}"
        return response
    except Exception as e:
        logger.error(f"VCI indices proxy error: {e}")
        return jsonify([])


# ===================== WORLD INDICES =====================

_WORLD_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^GDAXI', '^FTSE', '^N225', '^HSI', '000001.SS']
_WORLD_NAMES = {
    '^GSPC': 'S&P 500',
    '^IXIC': 'NASDAQ',
    '^DJI': 'Dow Jones',
    '^GDAXI': 'DAX',
    '^FTSE': 'FTSE 100',
    '^N225': 'Nikkei 225',
    '^HSI': 'Hang Seng',
    '000001.SS': 'Shanghai',
}
_YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
}

@market_bp.route('/world-indices')
def api_world_indices():
    """World stock indices from Yahoo Finance - cached 90s"""
    def fetch_world_indices():
        results = []
        for sym in _WORLD_SYMBOLS:
            try:
                url = f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=1d'
                r = http_requests.get(url, timeout=6, headers=_YAHOO_HEADERS)
                if r.status_code != 200:
                    continue
                data = r.json()
                meta = data['chart']['result'][0]['meta']
                price = float(meta.get('regularMarketPrice') or 0)
                prev = float(meta.get('chartPreviousClose') or meta.get('previousClose') or price)
                change = round(price - prev, 2)
                pct = round((change / prev) * 100, 2) if prev else 0
                results.append({
                    'symbol': sym,
                    'name': _WORLD_NAMES.get(sym, sym),
                    'price': price,
                    'change': change,
                    'changePercent': pct,
                })
            except Exception as e:
                logger.warning(f'world-indices: failed {sym}: {e}')
        return results

    try:
        data, _ = _cache_func('world_indices', 90, fetch_world_indices)
        return jsonify(data or [])
    except Exception as e:
        logger.error(f'world-indices error: {e}')
        return jsonify([])


# ===================== LOTTERY =====================

@market_bp.route('/lottery', methods=['GET'])
def get_lottery_results():
    """Get lottery results from RSS feed - CACHED 5 minutes"""
    region = request.args.get('region', 'mb')

    rss_map = {
        'mb': 'https://xosodaiphat.com/ket-qua-xo-so-mien-bac-xsmb.rss',
        'mn': 'https://xosodaiphat.com/ket-qua-xo-so-mien-nam-xsmn.rss',
        'mt': 'https://xosodaiphat.com/ket-qua-xo-so-mien-trung-xsmt.rss'
    }

    url = rss_map.get(region, rss_map['mb'])
    cache_key = f"lottery_{region}"

    def fetch_rss():
        response = http_requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
        response.raise_for_status()

        return parse_lottery_rss(content=response.content, region=region)

    data, _ = _cache_func(cache_key, 300, fetch_rss)
    return jsonify(data)
