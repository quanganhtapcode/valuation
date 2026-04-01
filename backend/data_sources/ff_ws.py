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
from typing import Any, Dict, Set

import websocket  # websocket-client

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

# ── In-memory price cache ─────────────────────────────────────────────────────
_prices: Dict[str, Dict[str, float]] = {}
_prices_lock = threading.Lock()

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


def _run_ws() -> None:
    backoff = 3

    while True:
        # Fresh decompressor for each connection (server resets context on reconnect)
        decompressor = zlib.decompressobj(wbits=-15)

        def _decompress(data: bytes) -> str:
            payload = data if data.endswith(_SYNC_TAIL) else data + _SYNC_TAIL
            return decompressor.decompress(payload).decode("utf-8")

        def _handle_text(text: str) -> None:
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
            _broadcast({"channel": name, **snap})

        def on_open(ws: websocket.WebSocketApp) -> None:
            nonlocal backoff
            logger.info("[FF] connected, subscribing %d channels", len(CHANNELS))
            backoff = 3
            for ch in CHANNELS:
                ws.send(json.dumps({"type": "subscribe", "channel": ch}))
                ws.send(json.dumps({"type": "subscribe", "channel": f"{ch}.partial"}))

        def on_message(ws: websocket.WebSocketApp, msg: Any) -> None:
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
                        ws.send("pong")
                    except Exception:
                        pass
                elif msg:
                    _handle_text(msg)

        def on_error(ws: websocket.WebSocketApp, error: Any) -> None:
            logger.warning("[FF] error: %s", error)

        def on_close(ws: websocket.WebSocketApp, code: Any, reason: Any) -> None:
            logger.info("[FF] closed %s %s", code, reason)

        try:
            ws_app = websocket.WebSocketApp(
                FF_WS_URL,
                on_open=on_open,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                header=FF_HEADERS,
            )
            ws_app.run_forever(skip_utf8_validation=True, ping_interval=0)
        except Exception as exc:
            logger.warning("[FF] run_forever crashed: %s", exc)

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
        t = threading.Thread(target=_run_ws, daemon=True, name="ff-ws")
        t.start()
        _started = True
        logger.info("[FF] background thread started")


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
