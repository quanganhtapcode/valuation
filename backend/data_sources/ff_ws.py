"""
Forex Factory WebSocket proxy
Connects to wss://mds-wss.forexfactory.com:2096 in a background thread,
decompresses binary frames with a persistent zlib context (permessage-deflate
with server context takeover), caches latest prices in RAM, and notifies
registered browser WS queues on every update.
"""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, Set

import requests as http_requests
import websocket  # websocket-client
try:
    from curl_cffi import requests as curl_requests
except Exception:  # pragma: no cover - optional dependency fallback
    curl_requests = None

logger = logging.getLogger(__name__)

FF_WS_URL = "wss://mds-wss.forexfactory.com:2096"
FF_HEADERS = {
    "Origin": "https://www.forexfactory.com",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.forexfactory.com/",
}
FF_IMPERSONATE = "chrome124"

CHANNELS = [
    # Forex pairs
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CHF", "USD/CAD", "NZD/USD",
    # Asia-Pacific indices
    "Nikkei225/USD", "ASX/USD",
    # European indices
    "DAX/USD", "FTSE100/USD", "CAC/USD", "STOXX50/USD",
    # US indices + volatility + dollar index
    "SPX/USD", "NDX/USD", "Dow/USD", "VIX/USD", "DXY/USD", "US2000/USD",
    # Commodities
    "Gold/USD", "Silver/USD", "WTI/USD", "Brent/USD", "BTC/USD", "ETH/USD",
]

_YAHOO_SYMBOLS = {
    "EUR/USD": "EURUSD=X",
    "GBP/USD": "GBPUSD=X",
    "USD/JPY": "USDJPY=X",
    "AUD/USD": "AUDUSD=X",
    "USD/CHF": "USDCHF=X",
    "USD/CAD": "USDCAD=X",
    "NZD/USD": "NZDUSD=X",
    "Nikkei225/USD": "^N225",
    "ASX/USD": "^AXJO",
    "DAX/USD": "^GDAXI",
    "FTSE100/USD": "^FTSE",
    "CAC/USD": "^FCHI",
    "STOXX50/USD": "^STOXX50E",
    "SPX/USD": "^GSPC",
    "NDX/USD": "^NDX",
    "Dow/USD": "^DJI",
    "VIX/USD": "^VIX",
    "DXY/USD": "DX-Y.NYB",
    "US2000/USD": "^RUT",
    "Gold/USD": "GC=F",
    "Silver/USD": "SI=F",
    "WTI/USD": "CL=F",
    "Brent/USD": "BZ=F",
    "BTC/USD": "BTC-USD",
    "ETH/USD": "ETH-USD",
}
_YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}
_YAHOO_STALE_AFTER_SEC = 45
_YAHOO_POLL_SEC = 15

# ── In-memory price cache ─────────────────────────────────────────────────────
_prices: Dict[str, Dict[str, float]] = {}
_prices_lock = threading.Lock()
_last_ff_update_ts = 0.0
_fallback_active = False

# Browser WS queues
_clients: Set[queue.Queue] = set()
_clients_lock = threading.Lock()

_started = False
_start_lock = threading.Lock()

_SYNC_TAIL = b"\x00\x00\xff\xff"


def _extract_price(msg: dict, prev_day_open: float | None) -> dict | None:
    agg = (msg.get("Quotes") or {}).get("MDSAgg")
    if not agg:
        return None
    price = agg.get("BidRounded") or agg.get("Bid")
    if price is None:
        return None

    day_open = prev_day_open or 0.0
    if not msg.get("Partial"):
        d1 = ((msg.get("Metrics") or {}).get("Metrics") or {}).get("D1") or {}
        ref = d1.get("price")
        if ref and ref > 0:
            day_open = float(ref)

    change_pct = ((price - day_open) / day_open * 100) if day_open > 0 else 0.0
    return {"price": price, "dayOpen": day_open, "changePercent": change_pct}


def _broadcast(update: dict) -> None:
    with _clients_lock:
        dead: Set[queue.Queue] = set()
        for q in _clients:
            try:
                q.put_nowait(update)
            except queue.Full:
                pass
            except Exception:
                dead.add(q)
        _clients.difference_update(dead)


def _short_error(error: Any, limit: int = 320) -> str:
    text = str(error)
    if len(text) > limit:
        return f"{text[:limit]}... (truncated)"
    return text


def _fetch_yahoo_quote(sym: str) -> dict | None:
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=1d"
        resp = http_requests.get(url, timeout=7, headers=_YAHOO_HEADERS)
        if resp.status_code != 200:
            return None
        result = ((resp.json().get("chart") or {}).get("result") or [None])[0] or {}
        meta = result.get("meta") or {}
        price = float(meta.get("regularMarketPrice") or 0)
        prev = float(meta.get("chartPreviousClose") or meta.get("previousClose") or 0)
        if price <= 0 or prev <= 0:
            return None
        return {
            "price": price,
            "dayOpen": prev,
            "changePercent": ((price - prev) / prev) * 100,
        }
    except Exception:
        return None


def _run_yahoo_fallback() -> None:
    global _fallback_active
    while True:
        with _prices_lock:
            last_primary_age = time.time() - _last_ff_update_ts if _last_ff_update_ts > 0 else float("inf")
            use_fallback = last_primary_age >= _YAHOO_STALE_AFTER_SEC

        if not use_fallback:
            if _fallback_active:
                _fallback_active = False
                logger.info("[FF] primary stream recovered, fallback disabled")
            time.sleep(2)
            continue

        updates = 0
        with ThreadPoolExecutor(max_workers=len(_YAHOO_SYMBOLS)) as pool:
            futures = {pool.submit(_fetch_yahoo_quote, sym): ch for ch, sym in _YAHOO_SYMBOLS.items()}
            for future in as_completed(futures):
                snap = future.result()
                if not snap:
                    continue
                channel = futures[future]
                should_broadcast = False
                with _prices_lock:
                    prev = _prices.get(channel)
                    if not prev or float(prev.get("price") or 0) != float(snap["price"]):
                        _prices[channel] = snap
                        should_broadcast = True
                if should_broadcast:
                    updates += 1
                    _broadcast({"channel": channel, **snap, "source": "yahoo_fallback"})

        if updates > 0:
            if not _fallback_active:
                logger.warning("[FF] no primary updates; using Yahoo fallback")
            _fallback_active = True
        time.sleep(_YAHOO_POLL_SEC)


def _run_ws() -> None:
    backoff = 3

    while True:
        # Fresh decompressor for each connection (server resets context on reconnect)
        decompressor = zlib.decompressobj(wbits=-15)

        def _decompress(data: bytes) -> str:
            payload = data if data.endswith(_SYNC_TAIL) else data + _SYNC_TAIL
            return decompressor.decompress(payload).decode("utf-8")

        def _handle_text(text: str) -> None:
            global _last_ff_update_ts, _fallback_active
            try:
                msg = json.loads(text)
            except Exception:
                return
            name = msg.get("Name")
            if not name:
                return
            with _prices_lock:
                prev = _prices.get(name, {})
                snap = _extract_price(msg, prev.get("dayOpen"))
                if snap is None:
                    return
                _prices[name] = snap
                _last_ff_update_ts = time.time()
            if _fallback_active:
                _fallback_active = False
                logger.info("[FF] primary stream recovered, fallback disabled")
            _broadcast({"channel": name, **snap, "source": "forexfactory"})

        def on_open() -> None:
            nonlocal backoff
            logger.info("[FF] connected, subscribing %d channels", len(CHANNELS))
            backoff = 3

        try:
            if curl_requests is not None:
                with curl_requests.Session() as session:
                    # Try direct WS connect first (faster); fall back to HTTP warmup if rejected
                    ws = None
                    try:
                        ws = session.ws_connect(
                            FF_WS_URL,
                            headers=FF_HEADERS,
                            impersonate=FF_IMPERSONATE,
                            timeout=15,
                        )
                    except Exception:
                        # Warmup cookies then retry
                        try:
                            session.get("https://www.forexfactory.com", impersonate=FF_IMPERSONATE, timeout=15)
                        except Exception:
                            pass
                        ws = session.ws_connect(
                            FF_WS_URL,
                            headers=FF_HEADERS,
                            impersonate=FF_IMPERSONATE,
                            timeout=15,
                        )
                    on_open()
                    for ch in CHANNELS:
                        ws.send(json.dumps({"type": "subscribe", "channel": ch}))
                        ws.send(json.dumps({"type": "subscribe", "channel": f"{ch}.partial"}))

                    while True:
                        packet = ws.recv()
                        if packet is None:
                            break
                        msg, _flags = packet if isinstance(packet, tuple) else (packet, None)
                        if isinstance(msg, (bytes, bytearray)):
                            raw = bytes(msg).strip()
                            if raw == b"ping":
                                ws.send(b"pong")
                                continue
                            if len(raw) <= 2:
                                continue
                            try:
                                _handle_text(_decompress(bytes(msg)))
                            except Exception as exc:
                                logger.debug("[FF] decompress error: %s", exc)
                        else:
                            text = str(msg).strip()
                            if text == "ping":
                                ws.send("pong")
                            elif text:
                                _handle_text(text)
                    try:
                        ws.close()
                    except Exception:
                        pass
            else:
                def on_open_legacy(ws_app: websocket.WebSocketApp) -> None:
                    on_open()
                    for ch in CHANNELS:
                        ws_app.send(json.dumps({"type": "subscribe", "channel": ch}))
                        ws_app.send(json.dumps({"type": "subscribe", "channel": f"{ch}.partial"}))

                def on_message_legacy(ws_app: websocket.WebSocketApp, msg: Any) -> None:
                    if isinstance(msg, bytes):
                        if len(msg) <= 10:
                            return  # skip short frames (ping etc.)
                        try:
                            _handle_text(_decompress(msg))
                        except Exception as exc:
                            logger.debug("[FF] decompress error: %s", exc)
                    elif isinstance(msg, str):
                        msg = msg.strip()
                        if msg == "ping":
                            try:
                                ws_app.send("pong")
                            except Exception:
                                pass
                        elif msg:
                            _handle_text(msg)

                def on_error_legacy(ws_app: websocket.WebSocketApp, error: Any) -> None:
                    logger.warning("[FF] error: %s", _short_error(error))

                def on_close_legacy(ws_app: websocket.WebSocketApp, code: Any, reason: Any) -> None:
                    logger.info("[FF] closed %s %s", code, reason)

                ws_app = websocket.WebSocketApp(
                    FF_WS_URL,
                    on_open=on_open_legacy,
                    on_message=on_message_legacy,
                    on_error=on_error_legacy,
                    on_close=on_close_legacy,
                    header=FF_HEADERS,
                )
                ws_app.run_forever(skip_utf8_validation=True, ping_interval=0)
        except Exception as exc:
            logger.warning("[FF] run_forever crashed: %s", _short_error(exc))

        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


# ── Public API ────────────────────────────────────────────────────────────────

def ensure_started() -> None:
    global _started
    if _started:
        return
    with _start_lock:
        if _started:
            return
        t_primary = threading.Thread(target=_run_ws, daemon=True, name="ff-ws")
        t_fallback = threading.Thread(target=_run_yahoo_fallback, daemon=True, name="ff-yahoo-fallback")
        t_primary.start()
        t_fallback.start()
        _started = True
        logger.info("[FF] background threads started")


def get_prices() -> Dict[str, Dict[str, float]]:
    with _prices_lock:
        return dict(_prices)


def register_client() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=200)
    with _clients_lock:
        _clients.add(q)
    return q


def unregister_client(q: queue.Queue) -> None:
    with _clients_lock:
        _clients.discard(q)
