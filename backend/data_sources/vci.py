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
import json
import struct
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
    _prices_source: str = 'EMPTY'
    _prices_ws_last_update: float = 0
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
    _prices_ws_thread_started = False
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
    _PRICE_RECENT_WS_SECONDS = max(1.0, float(os.getenv("VCI_PRICE_RECENT_WS_SECONDS", "2.5")))

    _INDEX_WS_CONNECT_TIMEOUT_SECONDS = max(3.0, float(os.getenv("VCI_INDEX_WS_CONNECT_TIMEOUT_SECONDS", "8")))
    _INDEX_WS_BACKOFF_MIN_SECONDS = max(1.0, float(os.getenv("VCI_INDEX_WS_BACKOFF_MIN_SECONDS", "2")))
    _INDEX_WS_BACKOFF_MAX_SECONDS = max(
        _INDEX_WS_BACKOFF_MIN_SECONDS,
        float(os.getenv("VCI_INDEX_WS_BACKOFF_MAX_SECONDS", "60")),
    )
    _INDEX_WS_BACKOFF_JITTER_SECONDS = max(0.0, float(os.getenv("VCI_INDEX_WS_BACKOFF_JITTER_SECONDS", "0.8")))
    _PRICE_WS_CONNECT_TIMEOUT_SECONDS = max(3.0, float(os.getenv("VCI_PRICE_WS_CONNECT_TIMEOUT_SECONDS", "8")))
    _PRICE_WS_BACKOFF_MIN_SECONDS = max(1.0, float(os.getenv("VCI_PRICE_WS_BACKOFF_MIN_SECONDS", "2")))
    _PRICE_WS_BACKOFF_MAX_SECONDS = max(
        _PRICE_WS_BACKOFF_MIN_SECONDS,
        float(os.getenv("VCI_PRICE_WS_BACKOFF_MAX_SECONDS", "60")),
    )
    _PRICE_WS_BACKOFF_JITTER_SECONDS = max(0.0, float(os.getenv("VCI_PRICE_WS_BACKOFF_JITTER_SECONDS", "0.8")))

    @classmethod
    def _to_float(cls, value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except Exception:
            return default

    @classmethod
    def _normalize_price_item(cls, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(item, dict):
            return None

        symbol = (
            item.get('s')
            or item.get('symbol')
            or item.get('Symbol')
            or item.get('ticker')
            or item.get('Ticker')
            or item.get('code')
            or item.get('Code')
        )
        if not symbol:
            return None

        symbol_u = str(symbol).upper()
        if len(symbol_u) > 8:
            return None

        out = dict(item)
        out['s'] = symbol_u

        numeric_keys = (
            'cei', 'flo', 'ref', 'c', 'mv', 'h', 'l',
            'frbv', 'frsv', 'frcrr', 'vo', 'va', 'tv',
            'op', 'avg', 'avgp', 'ch', 'chp',
            'bp1', 'bp2', 'bp3', 'bv1', 'bv2', 'bv3',
            'ap1', 'ap2', 'ap3', 'av1', 'av2', 'av3',
            'ptv', 'pta',
        )
        for k in numeric_keys:
            if k in out and out.get(k) is not None:
                out[k] = cls._to_float(out.get(k))

        return out

    @classmethod
    def _extract_price_items_from_payload(cls, payload: Any) -> List[Dict[str, Any]]:
        candidates: List[Dict[str, Any]] = []

        def collect(node: Any):
            if isinstance(node, list):
                for x in node:
                    collect(x)
                return

            if isinstance(node, dict):
                normalized = cls._normalize_price_item(node)
                if normalized:
                    candidates.append(normalized)

                for key in ('data', 'Data', 'payload', 'Payload', 'items', 'Items', 'result', 'Result', 'content'):
                    if key in node:
                        collect(node.get(key))

        collect(payload)

        by_symbol: Dict[str, Dict[str, Any]] = {}
        for item in candidates:
            by_symbol[str(item.get('s')).upper()] = item
        return list(by_symbol.values())

    @classmethod
    def _read_varint(cls, buf: bytes, offset: int) -> tuple[int, int]:
        value = 0
        shift = 0
        i = offset
        while i < len(buf):
            b = buf[i]
            i += 1
            value |= (b & 0x7F) << shift
            if (b & 0x80) == 0:
                return value, i
            shift += 7
        raise ValueError("Unexpected EOF while reading varint")

    @classmethod
    def _parse_protobuf_fields(cls, buf: bytes) -> List[tuple[int, int, Any]]:
        fields: List[tuple[int, int, Any]] = []
        i = 0
        while i < len(buf):
            key, i = cls._read_varint(buf, i)
            field_no = key >> 3
            wire_type = key & 0x7

            if wire_type == 0:  # varint
                val, i = cls._read_varint(buf, i)
                fields.append((field_no, wire_type, val))
            elif wire_type == 1:  # fixed64
                if i + 8 > len(buf):
                    break
                raw = buf[i:i + 8]
                i += 8
                fields.append((field_no, wire_type, struct.unpack("<d", raw)[0]))
            elif wire_type == 2:  # length-delimited
                ln, i = cls._read_varint(buf, i)
                raw = buf[i:i + ln]
                i += ln
                fields.append((field_no, wire_type, raw))
            elif wire_type == 5:  # fixed32
                if i + 4 > len(buf):
                    break
                raw = buf[i:i + 4]
                i += 4
                fields.append((field_no, wire_type, struct.unpack("<f", raw)[0]))
            else:
                break
        return fields

    @classmethod
    def _decode_ws_bid_ask_binary(cls, payload: bytes) -> Optional[Dict[str, Any]]:
        fields = cls._parse_protobuf_fields(payload)
        if not fields:
            return None

        update: Dict[str, Any] = {}
        bids: List[tuple[float, float]] = []
        asks: List[tuple[float, float]] = []

        for field_no, wire_type, value in fields:
            if wire_type != 2:
                continue
            raw: bytes = value
            if field_no == 2:
                try:
                    update["co"] = raw.decode("utf-8")
                except Exception:
                    pass
            elif field_no == 3:
                try:
                    update["s"] = raw.decode("utf-8").upper()
                except Exception:
                    pass
            elif field_no in (4, 5):
                pair_fields = cls._parse_protobuf_fields(raw)
                price = None
                volume = None
                for nested_no, nested_wire, nested_val in pair_fields:
                    if nested_wire != 1:
                        continue
                    if nested_no == 1:
                        price = cls._to_float(nested_val)
                    elif nested_no == 2:
                        volume = cls._to_float(nested_val)
                if price is not None and volume is not None:
                    if field_no == 4:
                        bids.append((price, volume))
                    else:
                        asks.append((price, volume))
            elif field_no == 6:
                try:
                    update["trsttc"] = raw.decode("utf-8")
                except Exception:
                    pass

        if not update.get("s"):
            return None

        for idx in range(3):
            bp, bv = bids[idx] if idx < len(bids) else (0.0, 0.0)
            ap, av = asks[idx] if idx < len(asks) else (0.0, 0.0)
            update[f"bp{idx + 1}"] = bp
            update[f"bv{idx + 1}"] = bv
            update[f"ap{idx + 1}"] = ap
            update[f"av{idx + 1}"] = av

        return cls._normalize_price_item(update)

    @classmethod
    def _decode_ws_match_price_binary(cls, payload: bytes) -> Optional[Dict[str, Any]]:
        fields = cls._parse_protobuf_fields(payload)
        if not fields:
            return None

        update: Dict[str, Any] = {}
        for field_no, wire_type, value in fields:
            if field_no == 2 and wire_type == 2:
                try:
                    update["co"] = value.decode("utf-8")
                except Exception:
                    pass
            elif field_no == 3 and wire_type == 2:
                try:
                    update["s"] = value.decode("utf-8").upper()
                except Exception:
                    pass
            elif field_no == 4 and wire_type == 1:
                update["c"] = cls._to_float(value)
            elif field_no == 5 and wire_type == 1:
                update["mv"] = cls._to_float(value)
            elif field_no == 6 and wire_type == 1:
                update["h"] = cls._to_float(value)
            elif field_no == 7 and wire_type == 1:
                update["l"] = cls._to_float(value)
            elif field_no == 10 and wire_type == 1:
                # REST "va" is in million VND; WS field is VND.
                update["va"] = cls._to_float(value) / 1_000_000.0
            elif field_no == 11 and wire_type == 1:
                update["pta"] = cls._to_float(value)
            elif field_no == 12 and wire_type == 2:
                try:
                    update["trsttc"] = value.decode("utf-8")
                except Exception:
                    pass
            elif field_no == 13 and wire_type == 1:
                update["ref"] = cls._to_float(value)
            elif field_no == 14 and wire_type == 1:
                update["cei"] = cls._to_float(value)
            elif field_no == 15 and wire_type == 1:
                update["flo"] = cls._to_float(value)
            elif field_no == 16 and wire_type == 1:
                update["vo"] = cls._to_float(value)
            elif field_no == 17 and wire_type == 1:
                update["avgp"] = cls._to_float(value)
            elif field_no == 18 and wire_type == 2:
                try:
                    update["matchPriceTime"] = value.decode("utf-8")
                except Exception:
                    pass
            elif field_no == 19 and wire_type == 1:
                update["op"] = cls._to_float(value)
            elif field_no == 20 and wire_type == 1:
                update["frbv"] = cls._to_float(value)
            elif field_no == 21 and wire_type == 1:
                update["frsv"] = cls._to_float(value)

        if not update.get("s"):
            return None
        return cls._normalize_price_item(update)

    @classmethod
    def _get_stock_subscription_symbols(cls) -> List[str]:
        symbols: List[str] = []

        # Prefer current cache to avoid extra network calls.
        if cls._price_cache:
            symbols = [str(sym).upper() for sym in cls._price_cache.keys() if sym]
            if symbols:
                return symbols

        # Fallback: warm symbols list from REST groups.
        groups = ['HOSE', 'HNX', 'UPCOM']
        combined: Dict[str, Dict[str, Any]] = {}
        for group in groups:
            try:
                combined.update(cls._fetch_group_prices(group))
            except Exception:
                continue
        return [str(sym).upper() for sym in combined.keys() if sym]

    @classmethod
    def _broadcast_price_updates(cls, changed: Dict[str, Dict[str, Any]]) -> None:
        if not changed or not cls._ws_clients:
            return
        import queue as _queue
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
    def _apply_price_updates(cls, updates: Dict[str, Dict[str, Any]], source: str, replace: bool = False) -> None:
        if not updates:
            return

        old_cache = cls._price_cache
        if replace:
            new_cache = dict(updates)
            merged_updates = updates
        else:
            new_cache = dict(old_cache)
            merged_updates: Dict[str, Dict[str, Any]] = {}
            for sym, item in updates.items():
                merged = dict(old_cache.get(sym) or {})
                merged.update(item or {})
                merged_updates[sym] = merged
            new_cache.update(merged_updates)

        changed: Dict[str, Dict[str, Any]] = {}
        for sym, item in merged_updates.items():
            old = old_cache.get(sym)
            if old is None:
                changed[sym] = item
                continue
            for key in ('c', 'vo', 'bp1', 'bp2', 'bp3', 'ap1', 'ap2', 'ap3', 'bv1', 'bv2', 'bv3', 'av1', 'av2', 'av3'):
                if old.get(key) != item.get(key):
                    changed[sym] = item
                    break

        cls._price_cache = new_cache
        now = time.time()
        cls._last_cache_update = now
        cls._prices_source = source
        if source == 'SOCKET_IO':
            cls._prices_ws_last_update = now

        cls._broadcast_price_updates(changed)

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
        """Fallback loop: use REST when socket data is stale or unavailable."""
        print(">>> [VCI] Starting background price refresh thread...", flush=True)
        # Blocking warm-up so cache is ready before first HTTP request arrives.
        try:
            cls.update_bulk_cache()
        except Exception as e:
            logger.error(f"[VCI] Initial warm-up failed: {e}")

        while True:
            if not cls._is_trading_hours():
                time.sleep(60)
                continue

            # WS is primary source. Skip REST if WS updated recently.
            if cls._prices_ws_last_update > 0 and (time.time() - cls._prices_ws_last_update) < cls._PRICE_RECENT_WS_SECONDS:
                time.sleep(1)
                continue

            try:
                cls.update_bulk_cache()
            except Exception as e:
                logger.error(f"[VCI] Background price refresh error: {e}")
            time.sleep(3)

    @classmethod
    def _prices_ws_loop(cls):
        """Socket.IO listener for Vietcap realtime domestic stock prices."""
        if socketio is None:
            logger.info("[VCI] python-socketio not installed; skip WS prices stream.")
            return

        reconnect_delay = cls._PRICE_WS_BACKOFF_MIN_SECONDS
        while True:
            sio = None
            try:
                sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)

                def _consume(payload: Any):
                    try:
                        if isinstance(payload, (bytes, bytearray)):
                            return
                        if isinstance(payload, str):
                            payload = json.loads(payload)
                        items = cls._extract_price_items_from_payload(payload)
                        if not items:
                            return
                        updates = {str(it.get('s')).upper(): it for it in items if it.get('s')}
                        cls._apply_price_updates(updates, source='SOCKET_IO', replace=False)
                    except Exception:
                        return

                def _consume_match_price(payload: Any):
                    try:
                        if isinstance(payload, (bytes, bytearray)):
                            decoded = cls._decode_ws_match_price_binary(bytes(payload))
                            if decoded and decoded.get("s"):
                                cls._apply_price_updates({str(decoded["s"]).upper(): decoded}, source='SOCKET_IO', replace=False)
                            return
                        _consume(payload)
                    except Exception:
                        return

                def _consume_bid_ask(payload: Any):
                    try:
                        if isinstance(payload, (bytes, bytearray)):
                            decoded = cls._decode_ws_bid_ask_binary(bytes(payload))
                            if decoded and decoded.get("s"):
                                cls._apply_price_updates({str(decoded["s"]).upper(): decoded}, source='SOCKET_IO', replace=False)
                            return
                        _consume(payload)
                    except Exception:
                        return

                subscribe_payloads = [
                    {'group': 'HOSE'},
                    {'group': 'HNX'},
                    {'group': 'UPCOM'},
                    {'group': ['HOSE', 'HNX', 'UPCOM']},
                    {'groups': ['HOSE', 'HNX', 'UPCOM']},
                    {'boards': ['HOSE', 'HNX', 'UPCOM']},
                    {'board': ['HOSE', 'HNX', 'UPCOM']},
                ]

                @sio.event
                def connect():
                    nonlocal reconnect_delay
                    logger.info("[VCI] Connected to Vietcap Socket.IO for stock prices.")
                    reconnect_delay = cls._PRICE_WS_BACKOFF_MIN_SECONDS

                    # Keep these initial emits aligned with browser flow seen in HAR.
                    try:
                        sio.emit('market-status', '[{"type":"all"}]')
                        sio.emit('app-config', '[{"type":"all"}]')
                    except Exception:
                        pass

                    try:
                        sio.emit('w-match-price', '{"symbols":[]}')
                        sio.emit('w-bid-ask', '{"symbols":[]}')
                        sio.emit('put-through', '{"symbols":[]}')
                    except Exception:
                        pass

                    symbols = cls._get_stock_subscription_symbols()
                    if symbols:
                        payload_str = json.dumps({'symbols': symbols}, separators=(',', ':'))
                        try:
                            sio.emit('w-match-price', payload_str)
                            sio.emit('w-bid-ask', payload_str)
                            sio.emit('put-through', payload_str)
                        except Exception:
                            pass

                    # Compatibility fallback emits.
                    for event_name in ('subscribe', 'sub', 'join', 'reg', 'register', 'watch', 'priceboard', 'prices'):
                        for payload in subscribe_payloads:
                            try:
                                sio.emit(event_name, payload)
                            except Exception:
                                continue

                @sio.event
                def connect_error(data):
                    logger.warning(f"[VCI] Prices Socket.IO connect_error: {data}")

                @sio.event
                def disconnect():
                    logger.warning("[VCI] Prices Socket.IO disconnected.")

                sio.on('w-match-price', handler=_consume_match_price)
                sio.on('w-bid-ask', handler=_consume_bid_ask)
                sio.on('put-through', handler=_consume)
                for event_name in (
                    'global-price',
                    'message',
                    'price',
                    'prices',
                    'ticker',
                    'tickers',
                    'stock',
                    'stocks',
                    'board',
                    'priceboard',
                    'data',
                    'update',
                ):
                    sio.on(event_name, handler=_consume)

                sio.connect(
                    cls.SOCKET_BASE_URL,
                    transports=['websocket'],
                    socketio_path=cls.SOCKET_PATH,
                    wait_timeout=cls._PRICE_WS_CONNECT_TIMEOUT_SECONDS,
                    headers={
                        'Origin': 'https://trading.vietcap.com.vn',
                        'Referer': 'https://trading.vietcap.com.vn/',
                        'User-Agent': cls.HEADERS.get('User-Agent', ''),
                    },
                )
                sio.wait()
            except Exception as exc:
                logger.warning(f"[VCI] Socket.IO prices loop error: {exc}")
            finally:
                try:
                    if sio is not None:
                        sio.disconnect()
                except Exception:
                    pass

            sleep_seconds = min(
                cls._PRICE_WS_BACKOFF_MAX_SECONDS,
                reconnect_delay + random.uniform(0, cls._PRICE_WS_BACKOFF_JITTER_SECONDS),
            )
            time.sleep(sleep_seconds)
            reconnect_delay = min(cls._PRICE_WS_BACKOFF_MAX_SECONDS, reconnect_delay * 2)

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
                    if socketio is not None and not cls._prices_ws_thread_started:
                        ws_thread = threading.Thread(target=cls._prices_ws_loop, daemon=True)
                        ws_thread.start()
                        cls._prices_ws_thread_started = True
                        print(">>> [VCI] Prices Socket.IO thread spawned.", flush=True)
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
                out: Dict[str, Dict[str, Any]] = {}
                for item in data:
                    normalized = cls._normalize_price_item(item)
                    if not normalized:
                        continue
                    out[str(normalized['s']).upper()] = normalized
                return out
        except Exception as e:
            logger.error(f"Failed to fetch group {group}: {e}")
        return {}

    @classmethod
    def get_market_indices(cls) -> List[Dict]:
        """Return market indices from RAM cache (zero latency) - background thread keeps it fresh"""
        return cls.get_cached_indices()

    @classmethod
    def update_bulk_cache(cls):
        """Poll REST fallback for all exchanges and merge into RAM cache."""
        from concurrent.futures import ThreadPoolExecutor
        groups = ['HOSE', 'HNX', 'UPCOM']
        new_cache = {}

        with ThreadPoolExecutor(max_workers=3) as executor:
            results = executor.map(cls._fetch_group_prices, groups)
            for res in results:
                new_cache.update(res)

        if not new_cache:
            return
        cls._apply_price_updates(new_cache, source='REST', replace=True)

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
