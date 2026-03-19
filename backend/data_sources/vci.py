"""
VCI (Vietcap) API Client
Direct API calls to Vietcap trading platform for realtime stock prices
NO vnstock quota used - completely free
"""

import requests
import logging
import time
import threading
import os
import random
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

try:
    import socketio  # type: ignore
except Exception:  # pragma: no cover
    socketio = None

logger = logging.getLogger(__name__)

class VCIClient:
    """Client for Vietcap trading API"""
    
    BASE_URL = "https://trading.vietcap.com.vn/api/price/v1/w/priceboard"
    
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'accept': 'application/json'
    }
    
    # Use a session for connection pooling
    _session = requests.Session()
    _session.headers.update(HEADERS)
    
    # Cache for bulk prices (stores the full data object for each symbol)
    _price_cache = {}
    _last_cache_update = 0
    _CACHE_TTL = 7 # Allow slightly longer TTL for background refresh

    # WebSocket push clients — queues that receive diffs after each poll
    _ws_clients: set = set()

    # Cache for market indices - refreshed every 1s in background
    _indices_cache: List[Dict] = []
    _indices_last_update: float = 0
    _indices_source: str = 'EMPTY'
    _indices_history: Dict[str, List[float]] = {} # symbol -> [p1, p2, p3... p30]
    _HISTORY_SIZE = 30
    
    # Background refresh state
    _refresh_thread_started = False
    _indices_thread_started = False
    _indices_ws_thread_started = False
    _lock = threading.Lock()

    INDEX_REST_URL = "https://trading.vietcap.com.vn/api/price/marketIndex/getList"
    INDEX_SYMBOLS = ["VNINDEX", "VN30", "HNXIndex", "HNX30", "HNXUpcomIndex"]
    SOCKET_BASE_URL = "https://trading.vietcap.com.vn"
    SOCKET_PATH = "ws/price/socket.io"

    _INDEX_REST_POLL_IDLE_SECONDS = max(1.0, float(os.getenv("VCI_INDEX_REST_POLL_IDLE_SECONDS", "3")))
    _INDEX_REST_POLL_JITTER_SECONDS = max(0.0, float(os.getenv("VCI_INDEX_REST_POLL_JITTER_SECONDS", "0.6")))
    _INDEX_RECENT_WS_SECONDS = max(1.0, float(os.getenv("VCI_INDEX_RECENT_WS_SECONDS", "2.5")))

    _INDEX_WS_CONNECT_TIMEOUT_SECONDS = max(3.0, float(os.getenv("VCI_INDEX_WS_CONNECT_TIMEOUT_SECONDS", "8")))
    _INDEX_WS_BACKOFF_MIN_SECONDS = max(1.0, float(os.getenv("VCI_INDEX_WS_BACKOFF_MIN_SECONDS", "2")))
    _INDEX_WS_BACKOFF_MAX_SECONDS = max(
        _INDEX_WS_BACKOFF_MIN_SECONDS,
        float(os.getenv("VCI_INDEX_WS_BACKOFF_MAX_SECONDS", "60")),
    )
    _INDEX_WS_BACKOFF_JITTER_SECONDS = max(0.0, float(os.getenv("VCI_INDEX_WS_BACKOFF_JITTER_SECONDS", "0.8")))

    @classmethod
    def _normalize_index_item(cls, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(item, dict):
            return None

        symbol = (
            item.get('symbol')
            or item.get('Symbol')
            or item.get('s')
            or item.get('index')
            or item.get('Index')
            or item.get('code')
            or item.get('Code')
        )
        if not symbol:
            return None

        symbol_u = str(symbol).upper()
        allowed = {s.upper() for s in cls.INDEX_SYMBOLS}
        if symbol_u not in allowed:
            return None

        price_raw = item.get('price')
        if price_raw is None:
            price_raw = item.get('Price')
        if price_raw is None:
            price_raw = item.get('c')
        if price_raw is None:
            price_raw = item.get('Index')

        ref_raw = item.get('refPrice')
        if ref_raw is None:
            ref_raw = item.get('RefPrice')
        if ref_raw is None:
            ref_raw = item.get('ref')
        if ref_raw is None:
            ref_raw = item.get('PrevIndex')

        try:
            price_val = float(price_raw) if price_raw is not None else 0.0
        except Exception:
            price_val = 0.0

        try:
            ref_val = float(ref_raw) if ref_raw is not None else 0.0
        except Exception:
            ref_val = 0.0

        normalized = dict(item)
        normalized['symbol'] = symbol_u
        normalized['price'] = price_val
        normalized['refPrice'] = ref_val
        return normalized

    @classmethod
    def _extract_index_items_from_payload(cls, payload: Any) -> List[Dict[str, Any]]:
        candidates: List[Dict[str, Any]] = []

        def collect(node: Any):
            if isinstance(node, list):
                for x in node:
                    collect(x)
                return

            if isinstance(node, dict):
                normalized = cls._normalize_index_item(node)
                if normalized:
                    candidates.append(normalized)

                for key in ('data', 'Data', 'payload', 'Payload', 'items', 'Items', 'result', 'Result'):
                    if key in node:
                        collect(node.get(key))

        collect(payload)

        by_symbol: Dict[str, Dict[str, Any]] = {}
        for item in candidates:
            by_symbol[str(item.get('symbol')).upper()] = item
        return list(by_symbol.values())

    @classmethod
    def _update_indices_cache(cls, items: List[Dict[str, Any]], source: str):
        if not items:
            return

        cls._indices_cache = items
        cls._indices_last_update = time.time()
        cls._indices_source = source

        for item in items:
            sym = item.get('symbol')
            val = item.get('price')
            if not sym or val is None:
                continue
            try:
                fv = float(val)
            except Exception:
                continue
            history = cls._indices_history.setdefault(str(sym), [])
            history.append(fv)
            if len(history) > cls._HISTORY_SIZE:
                cls._indices_history[str(sym)] = history[-cls._HISTORY_SIZE:]

    @classmethod
    def _fetch_indices_rest(cls) -> List[Dict[str, Any]]:
        payload = {"symbols": cls.INDEX_SYMBOLS}
        response = cls._session.post(cls.INDEX_REST_URL, json=payload, timeout=3)
        if response.status_code != 200:
            return []
        raw = response.json() or []
        return cls._extract_index_items_from_payload(raw)

    # Vietnam timezone (UTC+7)
    _VN_TZ = timezone(timedelta(hours=7))

    @classmethod
    def _is_trading_hours(cls) -> bool:
        """Return True if current Vietnam time is within active trading hours.
        HOSE/HNX trade weekdays 09:00–15:00 ICT (UTC+7).
        Includes a 5-minute buffer after close for ATC final prints.
        """
        now = datetime.now(cls._VN_TZ)
        if now.weekday() >= 5:  # Saturday=5, Sunday=6
            return False
        t = now.hour * 60 + now.minute  # minutes since midnight
        return 9 * 60 <= t <= 15 * 60 + 5  # 09:00 – 15:05

    @classmethod
    def _background_refresh_loop(cls):
        """Infinite loop: poll VCI every 3s during trading hours, idle otherwise."""
        print(">>> [VCI] Starting background price refresh thread...", flush=True)
        # Blocking warm-up so cache is ready before first HTTP request arrives
        try:
            cls.update_bulk_cache()
        except Exception as e:
            logger.error(f"[VCI] Initial warm-up failed: {e}")
        while True:
            if not cls._is_trading_hours():
                # Outside trading hours — sleep 60s, no VCI ping needed
                time.sleep(60)
                continue
            try:
                cls.update_bulk_cache()
            except Exception as e:
                logger.error(f"[VCI] Background price refresh error: {e}")
            time.sleep(3)

    @classmethod
    def _indices_refresh_loop(cls):
        """Background loop: keep indices fresh with REST fallback when WS is idle/unavailable."""
        print(">>> [VCI] Starting background INDICES refresh thread (fallback REST)...", flush=True)
        while True:
            try:
                # If WS has updated recently, skip REST call
                if cls._indices_last_update > 0 and (time.time() - cls._indices_last_update) < cls._INDEX_RECENT_WS_SECONDS:
                    time.sleep(1)
                    continue

                items = cls._fetch_indices_rest()
                if items:
                    cls._update_indices_cache(items, source='REST')
            except Exception as e:
                logger.error(f"[VCI] Indices background refresh error: {e}")
            sleep_seconds = cls._INDEX_REST_POLL_IDLE_SECONDS + random.uniform(0, cls._INDEX_REST_POLL_JITTER_SECONDS)
            time.sleep(sleep_seconds)

    @classmethod
    def _indices_ws_loop(cls):
        """Socket.IO listener for Vietcap realtime indices."""
        if socketio is None:
            logger.info("[VCI] python-socketio not installed; skip WS indices stream.")
            return

        reconnect_delay = cls._INDEX_WS_BACKOFF_MIN_SECONDS
        while True:
            sio = None
            try:
                sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)

                def _consume(payload: Any):
                    try:
                        items = cls._extract_index_items_from_payload(payload)
                        if items:
                            cls._update_indices_cache(items, source='SOCKET_IO')
                    except Exception:
                        return

                subscribe_payloads = [
                    {'symbols': cls.INDEX_SYMBOLS},
                    {'indexes': cls.INDEX_SYMBOLS},
                    {'symbol': cls.INDEX_SYMBOLS},
                ]

                @sio.event
                def connect():
                    nonlocal reconnect_delay
                    logger.info("[VCI] Connected to Vietcap Socket.IO for indices.")
                    reconnect_delay = cls._INDEX_WS_BACKOFF_MIN_SECONDS
                    for event_name in ('subscribe', 'sub', 'join', 'reg', 'register', 'watch', 'indices'):
                        for payload in subscribe_payloads:
                            try:
                                sio.emit(event_name, payload)
                            except Exception:
                                continue

                @sio.event
                def connect_error(data):
                    logger.warning(f"[VCI] Socket.IO connect_error: {data}")

                @sio.event
                def disconnect():
                    logger.warning("[VCI] Socket.IO disconnected.")

                for event_name in (
                    'message',
                    'price',
                    'prices',
                    'index',
                    'indices',
                    'marketIndex',
                    'marketIndices',
                    'market_index',
                    'market_indices',
                    'ticker',
                    'tickers',
                    'data',
                    'update',
                ):
                    sio.on(event_name, handler=_consume)

                sio.connect(
                    cls.SOCKET_BASE_URL,
                    transports=['websocket'],
                    socketio_path=cls.SOCKET_PATH,
                    wait_timeout=cls._INDEX_WS_CONNECT_TIMEOUT_SECONDS,
                    headers={
                        'Origin': 'https://trading.vietcap.com.vn',
                        'Referer': 'https://trading.vietcap.com.vn/',
                        'User-Agent': cls.HEADERS.get('User-Agent', ''),
                    },
                )
                sio.wait()
            except Exception as exc:
                logger.warning(f"[VCI] Socket.IO indices loop error: {exc}")
            finally:
                try:
                    if sio is not None:
                        sio.disconnect()
                except Exception:
                    pass

            sleep_seconds = min(
                cls._INDEX_WS_BACKOFF_MAX_SECONDS,
                reconnect_delay + random.uniform(0, cls._INDEX_WS_BACKOFF_JITTER_SECONDS),
            )
            time.sleep(sleep_seconds)
            reconnect_delay = min(cls._INDEX_WS_BACKOFF_MAX_SECONDS, reconnect_delay * 2)

    @classmethod
    def ensure_indices_refresh(cls):
        """Start background indices refresh thread once"""
        if not cls._indices_thread_started:
            with cls._lock:
                if not cls._indices_thread_started:
                    # Do a blocking first fetch so cache is ready before first request
                    try:
                        items = cls._fetch_indices_rest()
                        if items:
                            cls._update_indices_cache(items, source='REST')
                    except Exception as e:
                        logger.warning(f"[VCI] Initial indices fetch failed: {e}")

                    if socketio is not None and not cls._indices_ws_thread_started:
                        ws_thread = threading.Thread(target=cls._indices_ws_loop, daemon=True)
                        ws_thread.start()
                        cls._indices_ws_thread_started = True
                        print(">>> [VCI] Indices Socket.IO thread spawned.", flush=True)

                    thread = threading.Thread(target=cls._indices_refresh_loop, daemon=True)
                    thread.start()
                    cls._indices_thread_started = True
                    print(">>> [VCI] Indices background thread spawned.", flush=True)

    @classmethod
    def get_cached_indices(cls) -> List[Dict]:
        """Return market indices from RAM (no network call, updated in background)"""
        cls.ensure_indices_refresh()
        return cls._indices_cache

    @classmethod
    def get_indices_history(cls) -> Dict[str, List[float]]:
        """Return historical points for sparklines from RAM"""
        return cls._indices_history

    @classmethod
    def get_indices_source(cls) -> str:
        """Current source of indices cache (SOCKET_IO/REST/EMPTY)."""
        return cls._indices_source

    @classmethod
    def ensure_background_refresh(cls):
        """Ensures the background refresh thread is running (called on first access)"""
        if not cls._refresh_thread_started:
            with cls._lock:
                if not cls._refresh_thread_started:
                    thread = threading.Thread(target=cls._background_refresh_loop, daemon=True)
                    thread.start()
                    cls._refresh_thread_started = True
                    print(">>> [VCI] Background thread spawned.", flush=True)

    @classmethod
    def get_price(cls, symbol: str) -> Optional[float]:
        """Get instant price from RAM"""
        detail = cls.get_price_detail(symbol)
        if detail:
            return detail.get('price')
        return None

    @classmethod
    def get_price_detail(cls, symbol: str) -> Optional[Dict[str, Any]]:
        """Get full price detail from RAM (refreshed in background)"""
        symbol = symbol.upper()
        cls.ensure_background_refresh()
        
        # 1. Try RAM Cache
        item = cls._price_cache.get(symbol)
        if item:
            return {
                'symbol': item.get('s') or symbol,
                'price': float(item.get('c') or item.get('ref') or item.get('op') or 0),
                'ref_price': float(item.get('ref') or 0),
                'ceiling': float(item.get('cei') or 0),
                'floor': float(item.get('flo') or 0),
                'open': float(item.get('op') or 0),
                'high': float(item.get('h') or 0),
                'low': float(item.get('l') or 0),
                'volume': float(item.get('vo') or 0),
                'value': float(item.get('tv') or item.get('va') or 0),
                'change': float(item.get('ch') or 0),
                'change_pct': float(item.get('chp') or 0),
                'avg_price': float(item.get('avg') or 0),
                'source': item.get('source', 'VCI_RAM')
            }

        # 2. Direct Fallback if not in cache (fresh boot or rare ticker)
        try:
            url = f"{cls.BASE_URL}/ticker/price/{symbol}"
            response = cls._session.get(url, timeout=3)
            if response.status_code == 200:
                data = response.json()
                if data and len(data) > 0:
                    it = data[0]
                    return {
                        'symbol': it.get('s'),
                        'price': float(it.get('c') or it.get('ref') or 0),
                        'ref_price': float(it.get('ref') or 0),
                        'open': float(it.get('op') or 0),
                        'source': 'VCI_DIRECT'
                    }
        except Exception:
            pass
        return None

    @classmethod
    def _fetch_group_prices(cls, group: str) -> Dict[str, Dict]:
        """Fetch all prices for a specific exchange group from Vietcap"""
        try:
            url = f"{cls.BASE_URL}/tickers/price/group"
            response = cls._session.post(url, json={"group": group}, timeout=5)
            if response.status_code == 200:
                data = response.json()
                return { item['s']: item for item in data if 's' in item }
        except Exception as e:
            logger.error(f"Failed to fetch group {group}: {e}")
        return {}

    @classmethod
    def get_market_indices(cls) -> List[Dict]:
        """Return market indices from RAM cache (zero latency) - background thread keeps it fresh"""
        return cls.get_cached_indices()

    @classmethod
    def update_bulk_cache(cls):
        """Poll VCI for all exchanges, update RAM cache, broadcast diffs to WS clients."""
        from concurrent.futures import ThreadPoolExecutor
        import queue as _queue
        groups = ['HOSE', 'HNX', 'UPCOM']
        new_cache = {}

        with ThreadPoolExecutor(max_workers=3) as executor:
            results = executor.map(cls._fetch_group_prices, groups)
            for res in results:
                new_cache.update(res)

        if not new_cache:
            return

        # Compute diff: symbols whose price changed since last poll
        old_cache = cls._price_cache
        changed = {}
        for sym, item in new_cache.items():
            old = old_cache.get(sym)
            if old is None or old.get('c') != item.get('c') or old.get('vo') != item.get('vo'):
                changed[sym] = item

        cls._price_cache = new_cache
        cls._last_cache_update = time.time()

        # Push diffs to registered WS clients
        if changed and cls._ws_clients:
            with cls._lock:
                dead = set()
                for q in cls._ws_clients:
                    try:
                        q.put_nowait(changed)
                    except _queue.Full:
                        pass
                    except Exception:
                        dead.add(q)
                cls._ws_clients -= dead

    @classmethod
    def register_ws_client(cls) -> 'queue.Queue':
        """Register a queue to receive price diffs after each poll."""
        import queue as _queue
        q = _queue.Queue(maxsize=100)
        with cls._lock:
            cls._ws_clients.add(q)
        return q

    @classmethod
    def unregister_ws_client(cls, q) -> None:
        with cls._lock:
            cls._ws_clients.discard(q)

    @classmethod
    def get_all_prices(cls) -> Dict[str, Dict]:
        """Return full price cache dict (zero latency — already in RAM)."""
        return cls._price_cache

    @classmethod
    def get_multiple_prices(cls, symbols: List[str]) -> Dict[str, float]:
        """Get prices for multiple symbols instantly from RAM"""
        cls.ensure_background_refresh()
        results = {}
        for symbol in symbols:
            price = cls.get_price(symbol)
            if price:
                results[symbol.upper()] = price
        return results

    @classmethod
    def fetch_price_history(cls, symbol: str, page: int = 0, size: int = 250, time_frame: str = "ONE_DAY") -> Optional[Dict[str, Any]]:
        """
        Fetch historical price data for a single symbol from VCI IQ API.
        
        Args:
            symbol: Stock symbol (e.g., 'VCB')
            page: Page number (0-indexed)
            size: Number of records per page (max 250)
            time_frame: Time frame for candles (ONE_DAY, ONE_WEEK, etc.)
            
        Returns:
            Dict with 'data' key containing list of OHLCV records, or None on error
            Example: {
                'data': [
                    {
                        'tradingDate': '2024-01-15',
                        'open': 95.5,
                        'high': 97.0,
                        'low': 95.0,
                        'close': 96.5,
                        'volume': 1500000
                    }
                ]
            }
        """
        url = f"https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/{symbol.upper()}/price-history"
        params = {
            'timeFrame': time_frame,
            'page': page,
            'size': size
        }
        
        # VCI IQ API requires specific headers including origin and referer
        headers = {
            'accept': 'application/json',
            'accept-encoding': 'gzip',
            'origin': 'https://trading.vietcap.com.vn',
            'referer': 'https://trading.vietcap.com.vn/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        
        try:
            response = cls._session.get(url, params=params, headers=headers, timeout=15)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to fetch price history for {symbol} page {page}: {e}")
            return None

    @classmethod
    def fetch_price_history_batch(cls, symbol: str, pages: int = 10, size: int = 250, delay: float = 0.5) -> List[Dict[str, Any]]:
        """
        Fetch multiple pages of historical price data for a symbol.
        
        Args:
            symbol: Stock symbol (e.g., 'VCB')
            pages: Number of pages to fetch (default 10 = up to 2500 candles)
            size: Records per page (default 250, max 250)
            delay: Delay in seconds between requests (default 0.5s)
            
        Returns:
            List of all OHLCV records from all pages combined
            Example: [
                {
                    'tradingDate': '2024-01-15',
                    'open': 95.5,
                    'high': 97.0,
                    'low': 95.0,
                    'close': 96.5,
                    'volume': 1500000
                },
                ...
            ]
        """
        all_records = []
        
        for page in range(pages):
            result = cls.fetch_price_history(symbol, page=page, size=size)
            
            if not result:
                # API error, stop fetching
                logger.info(f"No response for {symbol} at page {page}, stopping")
                break
            
            # VCI API returns: {status: 200, successful: true, data: {content: [...]}}
            # Extract the actual records from nested structure
            records = []
            if isinstance(result, dict):
                data = result.get('data', {})
                if isinstance(data, dict):
                    records = data.get('content', [])
                elif isinstance(data, list):
                    # Sometimes data is directly a list
                    records = data
            
            if not records or len(records) == 0:
                # No more data available, stop fetching
                logger.info(f"No more data for {symbol} at page {page}, stopping")
                break
            
            all_records.extend(records)
            logger.info(f"Fetched page {page} for {symbol}: {len(records)} records")
            
            # Rate limiting: delay between requests
            if page < pages - 1:
                time.sleep(delay)
        
        logger.info(f"Total records fetched for {symbol}: {len(all_records)}")
        return all_records
