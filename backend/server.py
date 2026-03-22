
import warnings
warnings.filterwarnings("ignore", message="pkg_resources is deprecated as an API.*", category=UserWarning)

# Load environment variables FIRST
import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env'))

import logging
import json
from json import JSONDecodeError
import time
import queue
from datetime import datetime
from flask import Flask, g, request
from flask.json.provider import DefaultJSONProvider
from flask_compress import Compress
from flask_sock import Sock

# Import refactored data source modules
from backend.services import GoldService
from backend.extensions import init_provider
from backend.routes.stock_routes import stock_bp
from backend.routes.market import market_bp, init_market_routes
from backend.routes.download_routes import download_bp
from backend.routes.health_routes import health_bp
from backend.data_sources.vci import VCIClient
from backend.telemetry import record_request_latency

# Initialize Flask App
class _UnsortedJSONProvider(DefaultJSONProvider):
    sort_keys = False

app = Flask(__name__)
app.json_provider_class = _UnsortedJSONProvider
app.json = _UnsortedJSONProvider(app)
sock = Sock(app)

# Ensure JSON responses use UTF-8 encoding (display Vietnamese correctly)
app.config['JSON_AS_ASCII'] = False

# Enable gzip compression
compress = Compress()
compress.init_app(app)
app.config['COMPRESS_MIMETYPES'] = ['application/json', 'text/html', 'text/css', 'text/javascript']
app.config['COMPRESS_LEVEL'] = 6
app.config['COMPRESS_MIN_SIZE'] = 500

# Logging Setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# ============ MARKET DATA CACHE ============
# Cache for CafeF market data proxies - reduces API calls by 99%
market_cache = {}
MARKET_CACHE_TTL = {
    'realtime': 45,      # 45 seconds - Balances freshness with API limits
    'indices': 45,       # 45 seconds - Index data
    'pe_chart': 3600,    # 1 hour - Historical data
    'news': 300,         # 5 minutes - News
    'reports': 600       # 10 minutes - Reports
}

def get_cached_market_data(cache_key: str, ttl_seconds: int, fetch_func, should_cache_func=None):
    """
    Generic cache wrapper for market data.
    Returns cached data if still valid, otherwise fetches fresh data.
    """
    now = datetime.now()
    
    if cache_key in market_cache:
        data, cached_at = market_cache[cache_key]
        age_seconds = (now - cached_at).total_seconds()
        
        if age_seconds < ttl_seconds:
            logger.debug(f"Cache HIT: {cache_key} (age: {age_seconds:.1f}s)")
            return data, True  # Return cached data, is_cached=True
    
    # Cache miss or expired - fetch fresh data
    logger.info(f"Cache MISS: {cache_key} - fetching data...")
    fresh_data = fetch_func()
    
    # Check if we should cache
    do_cache = True
    if should_cache_func:
        try:
            do_cache = should_cache_func(fresh_data)
        except Exception as e:
            logger.error(f"Cache validator error for {cache_key}: {e}")
            do_cache = False # Don't cache on validator error

    # Store in cache
    if do_cache:
        market_cache[cache_key] = (fresh_data, now)
        logger.info(f"Cache STORE: {cache_key} (TTL: {ttl_seconds}s)")
    else:
        logger.warning(f"Cache SKIP: {cache_key} (Validator returned False)")
    
    return fresh_data, False  # Return fresh data, is_cached=False

# Initialize Global Provider
provider = init_provider()

# Initialize market routes with dependencies
init_market_routes(get_cached_market_data, MARKET_CACHE_TTL, GoldService)

# Warm-up: start background price refresh thread immediately so RAM cache is
# populated before the first HTTP request arrives (avoids cold-start latency).
VCIClient.ensure_background_refresh()

# Register Blueprints
app.register_blueprint(stock_bp, url_prefix='/api')
app.register_blueprint(market_bp)
app.register_blueprint(download_bp)
app.register_blueprint(health_bp)

# CORS Handling
@app.before_request
def _before_request_timer():
    g._request_started_at = time.perf_counter()


@app.after_request
def after_request(response):
    started = getattr(g, '_request_started_at', None)
    if started is not None:
        elapsed_ms = max(0.0, (time.perf_counter() - started) * 1000.0)
        route_rule = request.url_rule.rule if request.url_rule is not None else request.path
        route_key = f"{request.method} {route_rule}"
        record_request_latency(route_key, elapsed_ms)

        timing_value = f"app;dur={elapsed_ms:.2f}"
        existing_timing = response.headers.get('Server-Timing')
        if existing_timing:
            response.headers['Server-Timing'] = f"{existing_timing}, {timing_value}"
        else:
            response.headers['Server-Timing'] = timing_value

    header = response.headers
    header['Access-Control-Allow-Origin'] = '*'
    header['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    header['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'

    # Keep API responses compact for browsers, but pretty-print for curl and
    # explicit `?pretty=1` requests so terminal output is easier to read.
    if response.mimetype == 'application/json':
        ua = (request.headers.get('User-Agent') or '').lower()
        pretty_flag = (request.args.get('pretty') or '').strip().lower()
        wants_pretty = 'curl/' in ua or pretty_flag in {'1', 'true', 'yes'}
        if wants_pretty:
            raw = response.get_data(as_text=True)
            if raw:
                try:
                    parsed = json.loads(raw)
                    response.set_data(
                        json.dumps(parsed, ensure_ascii=False, indent=2, sort_keys=False) + '\n'
                    )
                except JSONDecodeError:
                    pass

    return response


def _build_indices_payload() -> dict:
    items = VCIClient.get_market_indices() or []
    by_symbol = {}
    for it in items:
        try:
            sym = str(it.get('symbol') or '').upper()
            if sym:
                by_symbol[sym] = it
        except Exception:
            continue

    symbol_map = {
        '1': 'VNINDEX',
        '2': 'HNXINDEX',
        '9': 'HNXUPCOMINDEX',
        '11': 'VN30',
    }

    data = {}
    for index_id, symbol in symbol_map.items():
        it = by_symbol.get(symbol)
        if not it:
            continue
        price = float(it.get('price') or 0)
        ref = float(it.get('refPrice') or 0)
        data[index_id] = {
            'CurrentIndex': price,
            'PrevIndex': ref,
            'Volume': float(it.get('totalShares') or 0),
            'Value': float(it.get('totalValue') or 0),
            'Advances': float(it.get('totalStockIncrease') or 0),
            'Declines': float(it.get('totalStockDecline') or 0),
            'NoChanges': float(it.get('totalStockNoChange') or 0),
            'Ceilings': float(it.get('totalStockCeiling') or 0),
            'Floors': float(it.get('totalStockFloor') or 0),
            'symbol': symbol,
        }

    return {
        'type': 'indices',
        'source': VCIClient.get_indices_source(),
        'serverTs': time.time(),
        'data': data,
    }


@sock.route('/ws/market/indices')
def ws_market_indices(ws):
    """Internal WS stream for frontend: pushes market index updates when data changes."""
    logger.info("WS client connected: /ws/market/indices")
    last_fingerprint = None
    last_ping = time.time()
    try:
        while True:
            payload = _build_indices_payload()
            data = payload.get('data', {})
            src = payload.get('source', 'EMPTY')

            fp_parts = [src]
            for key in ('1', '2', '9', '11'):
                item = data.get(key, {})
                fp_parts.append(f"{key}:{item.get('CurrentIndex', 0)}:{item.get('PrevIndex', 0)}")
            fingerprint = '|'.join(fp_parts)

            now = time.time()
            if fingerprint != last_fingerprint:
                ws.send(json.dumps(payload, ensure_ascii=False))
                last_fingerprint = fingerprint
                last_ping = now
            elif now - last_ping >= 30:
                # Keepalive ping: prevents Cloudflare/nginx from closing idle connection
                ws.send(json.dumps({'type': 'ping', 'serverTs': now}))
                last_ping = now

            time.sleep(0.5)
    except Exception as exc:
        logger.info(f"WS client disconnected: /ws/market/indices ({exc})")

def _handle_prices_ws(ws):
    """Internal WS stream for frontend: pushes real-time price updates."""
    logger.info("WS client connected: /ws/market/prices")

    # Send full price snapshot on initial connect
    try:
        current_prices = VCIClient.get_all_prices()
        init_data = {
            sym: {'c': d.get('c'), 'ref': d.get('ref'), 'vo': d.get('vo', 0)}
            for sym, d in current_prices.items()
            if d.get('c') and d.get('ref')
        }
        ws.send(json.dumps({'type': 'prices_init', 'data': init_data}, ensure_ascii=False))
    except Exception:
        pass

    q = VCIClient.register_ws_client()
    try:
        while True:
            try:
                updates = q.get(timeout=5)
                if updates:
                    formatted = {
                        sym: {'c': d.get('c'), 'ref': d.get('ref'), 'vo': float(d.get('vo', 0))}
                        for sym, d in updates.items()
                    }
                    ws.send(json.dumps({'type': 'prices_update', 'data': formatted}, ensure_ascii=False))
            except queue.Empty:
                ws.send(json.dumps({'type': 'tick', 'serverTs': time.time()}))
    except Exception as exc:
        logger.info(f"WS client disconnected: /ws/market/prices ({exc})")
    finally:
        VCIClient.unregister_ws_client(q)

# Register under both paths: direct and Nginx-rewritten
@sock.route('/ws/market/prices')
def ws_market_prices(ws):
    _handle_prices_ws(ws)

@sock.route('/api/ws/market/prices')
def ws_market_prices_api(ws):
    _handle_prices_ws(ws)

if __name__ == "__main__":
    logger.info("Vietnamese Stock Valuation Backend – running on http://0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
