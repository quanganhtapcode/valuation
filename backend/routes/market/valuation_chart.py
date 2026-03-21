from __future__ import annotations

import logging
import os
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any

import requests as http_requests
from flask import Blueprint, jsonify, request

from backend.data_sources.vci import VCIClient

from .deps import cache_func, cache_ttl
from .http_headers import VCI_HEADERS


logger = logging.getLogger(__name__)

_VCI_INDEX_VALUATION_URL = (
    "https://trading.vietcap.com.vn/api/iq-insight-service/v1/market-watch/index-valuation"
)
_VCI_OHLC_URL = "https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart"
_VCI_BREADTH_URL = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/market-watch/breadth"

# SQLite written daily by fetch_sqlite/fetch_vci_valuation.py
_VALUATION_SQLITE = (
    Path(__file__).resolve().parents[3] / "fetch_sqlite" / "vci_valuation.sqlite"
)


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


def _normalize_metric(metric: str | None) -> str:
    value = str(metric or "both").strip().lower()
    if value in {"pe", "pb", "both"}:
        return value
    return "both"


def _time_frame_to_cutoff(time_frame: str) -> date | None:
    """Return the inclusive start date for the given time frame, or None for ALL."""
    frame = str(time_frame or "ALL").strip().upper()
    if frame in {"", "ALL"}:
        return None
    today = date.today()
    if frame == "YTD":
        return date(today.year, 1, 1)
    if frame == "6M":
        month = today.month - 6
        year = today.year
        while month <= 0:
            month += 12
            year -= 1
        return date(year, month, min(today.day, 28))
    if frame == "1Y":
        return date(today.year - 1, today.month, min(today.day, 28))
    if frame == "2Y":
        return date(today.year - 2, today.month, min(today.day, 28))
    if frame == "5Y":
        return date(today.year - 5, today.month, min(today.day, 28))
    return None


def _apply_time_frame(
    series: list[dict[str, Any]],
    time_frame: str,
) -> list[dict[str, Any]]:
    """Filter a [{date, ...}] list by time frame (used for live VCI fallback only)."""
    cutoff = _time_frame_to_cutoff(time_frame)
    if cutoff is None:
        return series
    cutoff_str = cutoff.isoformat()
    return [item for item in series if str(item.get("date") or "") >= cutoff_str]


def _fetch_vci_index_valuation_series(
    *,
    metric: str,
    com_group_code: str = "VNINDEX",
    time_frame: str = "ALL",
) -> list[dict[str, Any]]:
    response = http_requests.get(
        _VCI_INDEX_VALUATION_URL,
        timeout=20,
        headers=VCI_HEADERS,
        params={
            "type": metric,
            "comGroupCode": com_group_code,
            "timeFrame": time_frame,
        },
    )
    response.raise_for_status()
    payload = response.json()
    values = ((payload or {}).get("data") or {}).get("values") or []
    out: list[dict[str, Any]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        date = str(item.get("date") or "").strip()
        raw_value = item.get("value")
        if not date or raw_value is None:
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        out.append({"date": date, "value": value})
    return out


def _fetch_vnindex_ohlc_series(*, count_back: int = 5000) -> list[dict[str, Any]]:
    import time as _time
    from datetime import datetime, timezone
    payload = {
        "timeFrame": "ONE_DAY",
        "symbols": ["VNINDEX"],
        "to": int(_time.time()),
        "countBack": count_back,
    }
    response = http_requests.post(
        _VCI_OHLC_URL,
        timeout=20,
        headers=VCI_HEADERS,
        json=payload,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list) or not data:
        return []
    item = data[0]
    timestamps = item.get("t") or []
    opens = item.get("o") or []
    highs = item.get("h") or []
    lows = item.get("l") or []
    closes = item.get("c") or []
    volumes = item.get("v") or []
    accumulated_volumes = item.get("accumulatedVolume") or []
    accumulated_values = item.get("accumulatedValue") or []
    out: list[dict[str, Any]] = []
    for i, ts in enumerate(timestamps):
        try:
            date_str = datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")
            close = float(closes[i]) if i < len(closes) and closes[i] is not None else None
            out.append(
                {
                    "date": date_str,
                    "value": close,
                    "open": float(opens[i]) if i < len(opens) and opens[i] is not None else None,
                    "high": float(highs[i]) if i < len(highs) and highs[i] is not None else None,
                    "low": float(lows[i]) if i < len(lows) and lows[i] is not None else None,
                    "close": close,
                    "volume": float(volumes[i]) if i < len(volumes) and volumes[i] is not None else None,
                    "accumulated_volume": (
                        float(accumulated_volumes[i])
                        if i < len(accumulated_volumes) and accumulated_volumes[i] is not None
                        else None
                    ),
                    "accumulated_value": (
                        float(accumulated_values[i])
                        if i < len(accumulated_values) and accumulated_values[i] is not None
                        else None
                    ),
                }
            )
        except (TypeError, ValueError):
            continue
    return out


def _attach_ema50(series: list[dict[str, Any]], period: int = 50) -> list[dict[str, Any]]:
    if not series:
        return series

    multiplier = 2 / (period + 1)
    ema: float | None = None
    warmup: list[float] = []

    for item in series:
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

    return series


def _read_valuation_from_sqlite(cutoff_date: date | None = None) -> dict[str, Any] | None:
    """Read valuation history from SQLite filtered by cutoff_date, returning flat data rows."""
    db = _VALUATION_SQLITE
    if not db.exists():
        return None
    try:
        with sqlite3.connect(str(db)) as conn:
            conn.row_factory = sqlite3.Row
            where = f"WHERE date >= '{cutoff_date.isoformat()}'" if cutoff_date else ""
            rows = conn.execute(
                f"SELECT date, pe, pb, vnindex, open, high, low, close, ema50, volume "
                f"FROM valuation_history {where} ORDER BY date"
            ).fetchall()
            if not rows:
                return None
            try:
                stat_rows = conn.execute(
                    "SELECT metric, average, plus_one_sd, plus_two_sd, minus_one_sd, minus_two_sd "
                    "FROM valuation_stats"
                ).fetchall()
            except Exception:
                stat_rows = []

        data = [
            {
                "date":    r["date"],
                "vnindex": r["vnindex"],
                "open":    r["open"],
                "high":    r["high"],
                "low":     r["low"],
                "close":   r["close"],
                "ema50":   r["ema50"],
                "pe":      r["pe"],
                "pb":      r["pb"],
                "volume":  r["volume"],
            }
            for r in rows
            if r["vnindex"] is not None or r["pe"] is not None or r["pb"] is not None
        ]

        stats: dict[str, Any] = {}
        for sr in stat_rows:
            stats[sr["metric"]] = {
                "average":    sr["average"],
                "plusOneSD":  sr["plus_one_sd"],
                "plusTwoSD":  sr["plus_two_sd"],
                "minusOneSD": sr["minus_one_sd"],
                "minusTwoSD": sr["minus_two_sd"],
            }

        return {"data": data, "stats": stats}
    except Exception as exc:
        logger.warning("Failed to read valuation SQLite: %s", exc)
        return None


def _read_ema_breadth_from_sqlite(limit: int = 260) -> list[dict[str, Any]]:
    db = _VALUATION_SQLITE
    if not db.exists():
        return []

    try:
        with sqlite3.connect(str(db)) as conn:
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

        out: list[dict[str, Any]] = []
        for row in reversed(rows):
            above = int(row["above_count"] or 0)
            total = int(row["total_count"] or 0)
            below = max(0, total - above)
            percent = float(row["above_percent"]) if row["above_percent"] is not None else (above / total if total > 0 else 0.0)
            out.append(
                {
                    "date": row["trading_date"],
                    "aboveEma50": above,
                    "belowEma50": below,
                    "total": total,
                    "abovePercent": percent,
                }
            )
        return out
    except Exception as exc:
        logger.warning("Failed to read EMA50 breadth SQLite: %s", exc)
        return []


def _read_ema_breadth_live(limit: int = 260) -> list[dict[str, Any]]:
    try:
        response = http_requests.get(
            _VCI_BREADTH_URL,
            timeout=20,
            headers=VCI_HEADERS,
            params={
                "condition": "EMA50",
                "exchange": "HSX,HNX,UPCOM",
                "enNumberOfDays": "ALL",
            },
        )
        response.raise_for_status()
        payload = response.json()
        rows = payload.get("data") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return []

        out: list[dict[str, Any]] = []
        for item in rows:
            try:
                date_value = str(item.get("tradingDate") or "").strip()
                if not date_value:
                    continue
                above = int(float(item.get("count") or 0))
                total = int(float(item.get("total") or 0))
                if total <= 0:
                    continue
                percent_raw = item.get("percent")
                percent = float(percent_raw) if percent_raw is not None else (above / total)
                out.append(
                    {
                        "date": date_value,
                        "aboveEma50": above,
                        "belowEma50": max(0, total - above),
                        "total": total,
                        "abovePercent": percent,
                    }
                )
            except Exception:
                continue

        out.sort(key=lambda x: x.get("date") or "")
        return out[-max(30, min(limit, 4000)):]
    except Exception as exc:
        logger.warning("Failed to read EMA50 breadth live: %s", exc)
        return []


def fetch_vci_index_valuation_payload(
    *,
    metric: str = "both",
    com_group_code: str = "VNINDEX",
    time_frame: str = "ALL",
) -> dict[str, Any]:
    cutoff = _time_frame_to_cutoff(time_frame)

    # SQLite path (VNINDEX only) — filter in SQL, return flat unified rows
    if com_group_code.upper() == "VNINDEX":
        sqlite_data = _read_valuation_from_sqlite(cutoff_date=cutoff)
        if sqlite_data:
            return {
                "success": True,
                "source": "SQLite",
                "index": com_group_code,
                "timeFrame": time_frame,
                "stats": sqlite_data["stats"],
                "data": sqlite_data["data"],
            }

    # Live VCI fallback — merge pe/pb/vnindex series by date
    selected = _normalize_metric(metric)
    pe_series_raw: list[dict[str, Any]] = []
    pb_series_raw: list[dict[str, Any]] = []
    if selected in {"pe", "both"}:
        pe_series_raw = _fetch_vci_index_valuation_series(
            metric="pe", com_group_code=com_group_code, time_frame=time_frame
        )
    if selected in {"pb", "both"}:
        pb_series_raw = _fetch_vci_index_valuation_series(
            metric="pb", com_group_code=com_group_code, time_frame=time_frame
        )
    vnindex_raw: list[dict[str, Any]] = []
    if com_group_code.upper() == "VNINDEX":
        try:
            vnindex_raw = _fetch_vnindex_ohlc_series()
        except Exception as exc:
            logger.warning("Failed to fetch VNINDEX OHLC: %s", exc)

    by_date: dict[str, dict[str, Any]] = {}
    for item in pe_series_raw:
        by_date.setdefault(item["date"], {})["pe"] = item["value"]
    for item in pb_series_raw:
        by_date.setdefault(item["date"], {})["pb"] = item["value"]
    for item in _attach_ema50(vnindex_raw):
        row = by_date.setdefault(item["date"], {})
        row["vnindex"] = item.get("value")
        row["ema50"] = item.get("ema50")
        row["volume"] = item.get("volume")

    cutoff_str = cutoff.isoformat() if cutoff else None
    data = [
        {
            "date": d,
            "vnindex": v.get("vnindex"),
            "ema50": v.get("ema50"),
            "pe": v.get("pe"),
            "pb": v.get("pb"),
            "volume": v.get("volume"),
        }
        for d, v in sorted(by_date.items())
        if cutoff_str is None or d >= cutoff_str
    ]

    return {
        "success": True,
        "source": "VCI",
        "index": com_group_code,
        "timeFrame": time_frame,
        "stats": {},
        "data": data,
    }


def register(market_bp: Blueprint) -> None:
    @market_bp.route("/pe-chart")
    @market_bp.route("/index-valuation-chart")
    def api_market_pe_chart():
        metric = _normalize_metric(request.args.get("metric", "both"))
        index = (request.args.get("index") or "VNINDEX").strip().upper()
        time_frame = (request.args.get("timeFrame") or "ALL").strip().upper()
        cache_key = f"index_valuation_{index}_{time_frame}_{metric}"

        def fetch_index_valuation():
            return fetch_vci_index_valuation_payload(
                metric=metric, com_group_code=index, time_frame=time_frame
            )

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("pe_chart", 3600), fetch_index_valuation)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as e:
            logger.error(f"Index valuation proxy error: {e}")
            return jsonify({"error": str(e)}), 500

    @market_bp.route('/ema50-breadth')
    def api_market_ema50_breadth():
        try:
            days = int(request.args.get("days", "260"))
        except Exception:
            days = 260
        days = max(30, min(days, 4000))

        cache_key = f"ema50_breadth_{days}"

        def fetch_breadth():
            series = _read_ema_breadth_from_sqlite(limit=days)
            source = "SQLite"
            if not series:
                series = _read_ema_breadth_live(limit=days)
                source = "VCI-live"
            if not series:
                return {"success": False, "data": []}
            latest = series[-1]
            return {
                "success": True,
                "source": source,
                "condition": "EMA50",
                "data": series,
                "latest": latest,
            }

        try:
            data, is_cached = cache_func()(cache_key, cache_ttl().get("pe_chart", 3600), fetch_breadth)
            resp = jsonify(data)
            resp.headers["X-Cache"] = "HIT" if is_cached else "MISS"
            return resp
        except Exception as exc:
            logger.error("EMA50 breadth error: %s", exc)
            return jsonify({"success": False, "data": []}), 500
