from __future__ import annotations

import datetime as dt
import json
import logging
import sqlite3
from pathlib import Path
from typing import Any

import requests as http_requests
from flask import Blueprint, jsonify, request

from .deps import cache_func, cache_ttl
from .http_headers import VCI_HEADERS


logger = logging.getLogger(__name__)

_VCI_FOREIGN_NET_URL = (
    "https://trading.vietcap.com.vn/api/market-watch/v3/ForeignNetValue/top"
)
_VCI_FOREIGN_VOLUME_URL = (
    "https://trading.vietcap.com.vn/api/market-watch/v3/ForeignVolumeChart/getAll"
)

_NET_BODY = {"timeFrame": "ONE_DAY", "comGroupCode": "VNINDEX", "exchange": "HOSE"}
_VOL_BODY = {"timeFrame": "ONE_DAY", "comGroupCode": "VNINDEX", "exchange": "HOSE"}

_FOREIGN_SQLITE = (
    Path(__file__).resolve().parents[3] / "fetch_sqlite" / "vci_foreign.sqlite"
)

_MAX_SQLITE_AGE_S = 90  # treat SQLite data stale after 90 seconds


# ─── SQLite readers ───────────────────────────────────────────────────────────

def _sqlite_connect() -> sqlite3.Connection | None:
    if not _FOREIGN_SQLITE.exists():
        return None
    try:
        conn = sqlite3.connect(str(_FOREIGN_SQLITE), timeout=5)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception:
        return None


def _vn_today() -> str:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).strftime("%Y-%m-%d")


def _is_fresh(fetched_at: str | None, max_age: int = _MAX_SQLITE_AGE_S) -> bool:
    if not fetched_at:
        return False
    try:
        ts = dt.datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=dt.timezone.utc)
        return (dt.datetime.now(tz=dt.timezone.utc) - ts).total_seconds() <= max_age
    except Exception:
        return False


def _read_net_from_sqlite() -> dict[str, Any] | None:
    conn = _sqlite_connect()
    if not conn:
        return None
    try:
        row = conn.execute(
            "SELECT raw_json, fetched_at FROM foreign_net_snapshot WHERE trading_date = ? ORDER BY fetched_at DESC LIMIT 1",
            (_vn_today(),),
        ).fetchone()
        if not row:
            return None
        payload = json.loads(row["raw_json"])
        return {
            "buyList":  payload.get("buyList",  []),
            "sellList": payload.get("sellList", []),
            "fetched_at": row["fetched_at"],
        }
    except Exception as exc:
        logger.warning("foreign_net SQLite read error: %s", exc)
        return None
    finally:
        conn.close()


def _read_volume_from_sqlite() -> list[dict] | None:
    conn = _sqlite_connect()
    if not conn:
        return None
    try:
        rows = conn.execute(
            """SELECT minute, buy_volume, sell_volume, buy_value, sell_value
               FROM foreign_volume_minute
               WHERE trading_date = ?
               ORDER BY minute""",
            (_vn_today(),),
        ).fetchall()
        if not rows:
            return None
        return [
            {
                "time":       r["minute"],
                "buyVolume":  r["buy_volume"],
                "sellVolume": r["sell_volume"],
                "buyValue":   r["buy_value"],
                "sellValue":  r["sell_value"],
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning("foreign_vol SQLite read error: %s", exc)
        return None
    finally:
        conn.close()


# ─── Normalise helpers ────────────────────────────────────────────────────────

def _normalize_to_mover(item: dict[str, Any], *, is_buy: bool) -> dict[str, Any]:
    symbol = item.get("ticker") or item.get("symbol") or item.get("code") or ""
    name   = item.get("companyName") or item.get("name") or item.get("stockName") or symbol
    price  = float(item.get("price") or item.get("closePrice") or item.get("matchPrice") or 0)
    change = float(item.get("changePercent") or item.get("changePct") or item.get("percentChange") or 0)
    net    = float(item.get("netBuyValue") or item.get("netValue") or item.get("netBuySellValue") or 0)
    return {
        "Symbol":             symbol.upper(),
        "CompanyName":        name,
        "CurrentPrice":       price,
        "ChangePricePercent": change,
        "Exchange":           item.get("exchange") or item.get("floorCode") or "HOSE",
        "Value":              abs(net),
    }


def _split_buy_sell(raw: Any) -> tuple[list[dict], list[dict]]:
    if not isinstance(raw, dict):
        return [], []
    data = raw.get("data") or raw
    if isinstance(data, dict):
        buy  = data.get("BuyList")  or data.get("buyList")  or []
        sell = data.get("SellList") or data.get("sellList") or []
        if buy or sell:
            return buy, sell
    items = data if isinstance(data, list) else []
    buy, sell = [], []
    for item in items:
        net = float(item.get("netBuyValue") or item.get("netValue") or item.get("netBuySellValue") or 0)
        (buy if net >= 0 else sell).append(item)
    return buy, sell


def _fetch_net_live() -> dict[str, Any]:
    r = http_requests.post(_VCI_FOREIGN_NET_URL, json=_NET_BODY, timeout=10, headers=VCI_HEADERS)
    r.raise_for_status()
    return r.json()


# ─── Route registration ───────────────────────────────────────────────────────

def register(market_bp: Blueprint) -> None:

    # ------------------------------------------------------------------
    # /foreign-flow?type=buy|sell  — backwards-compatible for sidebar
    # ------------------------------------------------------------------
    @market_bp.route("/foreign-flow")
    def api_market_foreign_flow():
        flow_type = request.args.get("type", "buy")
        cache_key = f"foreign_net_vci_{flow_type}"

        def fetch():
            # 1. Try SQLite (written by fetch_vci_foreign.py cron)
            db = _read_net_from_sqlite()
            if db and _is_fresh(db.get("fetched_at")):
                raw_list = db["buyList"] if flow_type == "buy" else db["sellList"]
                return {
                    "Data": [_normalize_to_mover(i, is_buy=(flow_type == "buy")) for i in raw_list[:10]],
                    "Success": True,
                    "source": "sqlite",
                }
            # 2. Fall back to live VCI API
            raw = _fetch_net_live()
            buy_raw, sell_raw = _split_buy_sell(raw)
            items = buy_raw if flow_type == "buy" else sell_raw
            return {
                "Data": [_normalize_to_mover(i, is_buy=(flow_type == "buy")) for i in items[:10]],
                "Success": True,
                "source": "live",
            }

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("realtime", 45), fetch)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as exc:
            logger.error("Foreign flow error: %s", exc)
            return jsonify({"Data": [], "Success": False})

    # ------------------------------------------------------------------
    # /foreign-net-value  — full buy+sell for /foreign page
    # ------------------------------------------------------------------
    @market_bp.route("/foreign-net-value")
    def api_market_foreign_net_value():
        def fetch():
            db = _read_net_from_sqlite()
            if db and _is_fresh(db.get("fetched_at")):
                return {
                    "success":  True,
                    "buyList":  [_normalize_to_mover(i, is_buy=True)  for i in db["buyList"]],
                    "sellList": [_normalize_to_mover(i, is_buy=False) for i in db["sellList"]],
                    "source":   "sqlite",
                }
            raw = _fetch_net_live()
            buy_raw, sell_raw = _split_buy_sell(raw)
            return {
                "success":  True,
                "buyList":  [_normalize_to_mover(i, is_buy=True)  for i in buy_raw],
                "sellList": [_normalize_to_mover(i, is_buy=False) for i in sell_raw],
                "source":   "live",
            }

        try:
            data, is_cached = cache_func()("foreign_net_full", cache_ttl().get("realtime", 45), fetch)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as exc:
            logger.error("Foreign net value error: %s", exc)
            return jsonify({"success": False, "buyList": [], "sellList": []})

    # ------------------------------------------------------------------
    # /foreign-volume-chart  — minute-bars for intraday chart
    # ------------------------------------------------------------------
    @market_bp.route("/foreign-volume-chart")
    def api_market_foreign_volume_chart():
        def fetch():
            # 1. SQLite (no freshness check — volume data accumulates during the day)
            db_points = _read_volume_from_sqlite()
            if db_points:
                return {"success": True, "data": db_points, "source": "sqlite"}
            # 2. Live fallback
            r = http_requests.post(_VCI_FOREIGN_VOLUME_URL, json=_VOL_BODY, timeout=10, headers=VCI_HEADERS)
            r.raise_for_status()
            raw = r.json()
            points = (raw or {}).get("data") or (raw or {}).get("Data") or (raw if isinstance(raw, list) else [])
            return {"success": True, "data": points if isinstance(points, list) else [], "source": "live"}

        try:
            data, is_cached = cache_func()("foreign_volume_chart", cache_ttl().get("realtime", 45), fetch)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as exc:
            logger.error("Foreign volume chart error: %s", exc)
            return jsonify({"success": False, "data": []})
