"""
Forex Factory WebSocket proxy
Connects to wss://mds-wss.forexfactory.com:2096 in a background thread,
decompresses binary frames with zlib, caches latest prices in RAM,
and notifies registered browser WS queues on every update.
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

# Channels we subscribe to
CHANNELS = [
    "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CHF", "USD/CAD", "NZD/USD",
    "SPX/USD", "NAS/USD", "DJIA/USD", "DAX/EUR", "FTSE/GBP", "NIK/JPY",
    "GOLD/USD", "WTIC/USD", "BTC/USD", "ETH/USD",
]

# ── In-memory price cache ─────────────────────────────────────────────────────
# { channel: { "price": float, "dayOpen": float, "changePercent": float } }
_prices: Dict[str, Dict[str, float]] = {}
_prices_lock = threading.Lock()

# Browser WS queues (one per connected client)
_clients: Set[queue.Queue] = set()
_clients_lock = threading.Lock()

_started = False
_start_lock = threading.Lock()


def _decompress(data: bytes) -> str:
    """Try zlib then raw-deflate; raise if both fail."""
    try:
        return zlib.decompress(data).decode("utf-8")
    except Exception:
        pass
    try:
        return zlib.decompress(data, wbits=-15).decode("utf-8")
    except Exception:
        pass
    raise ValueError("ff_ws: decompress failed")


def _extract_price(msg: dict, prev_day_open: float | None) -> dict | None:
    agg = (msg.get("Quotes") or {}).get("MDSAgg")
    if not agg:
        return None
    price = agg.get("BidRounded") or agg.get("Bid")
    if price is None:
        return None

    day_open = prev_day_open or 0.0
    if not msg.get("Partial"):
        d1 = (msg.get("Metrics") or {}).get("Metrics", {}).get("D1", {})
        ref = d1.get("price")
        if ref and ref > 0:
            day_open = ref

    change_pct = ((price - day_open) / day_open * 100) if day_open > 0 else 0.0
    return {"price": price, "dayOpen": day_open, "changePercent": change_pct}


def _broadcast(update: dict) -> None:
    """Push update to all registered browser WS queues."""
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
    partial_buf = ""
    ws_app: websocket.WebSocketApp | None = None

    def on_open(ws: websocket.WebSocketApp) -> None:
        logger.info("[FF] WS connected, subscribing %d channels", len(CHANNELS))
        for ch in CHANNELS:
            ws.send(json.dumps({"type": "subscribe", "channel": ch}))
            ws.send(json.dumps({"type": "subscribe", "channel": f"{ch}.partial"}))

    def on_binary(ws: websocket.WebSocketApp, data: bytes) -> None:
        try:
            text = _decompress(data)
        except Exception as exc:
            logger.debug("[FF] decompress failed: %s", exc)
            return
        _handle_text(text)

    def on_message(ws: websocket.WebSocketApp, message: str) -> None:
        nonlocal partial_buf
        partial_buf += message
        if "\n" not in partial_buf:
            return
        lines = partial_buf.split("\n")
        partial_buf = lines.pop()
        for line in lines:
            if line == "ping":
                try:
                    ws.send("pong")
                except Exception:
                    pass
            elif line:
                _handle_text(line)

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

        update = {"channel": name, **snap}
        _broadcast(update)

    def on_error(ws: websocket.WebSocketApp, error: Any) -> None:
        logger.warning("[FF] WS error: %s", error)

    def on_close(ws: websocket.WebSocketApp, code: Any, msg: Any) -> None:
        logger.info("[FF] WS closed: %s %s — reconnecting in 3s", code, msg)

    backoff = 3
    while True:
        try:
            ws_app = websocket.WebSocketApp(
                FF_WS_URL,
                on_open=on_open,
                on_binary=on_binary,
                on_message=on_message,
                on_error=on_error,
                on_close=on_close,
                header={"Origin": "https://www.forexfactory.com"},
            )
            ws_app.run_forever(ping_interval=0)
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
        t = threading.Thread(target=_run_ws, daemon=True, name="ff-ws-thread")
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
