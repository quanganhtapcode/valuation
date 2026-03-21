#!/usr/bin/env python3
"""Fetch VCI index valuation (PE TTM, PB TTM) and VNINDEX OHLC into SQLite.

Run daily after market close (e.g. 18:30) to keep vci_valuation.sqlite fresh.
Source endpoints:
  - GET  https://trading.vietcap.com.vn/api/iq-insight-service/v1/market-watch/index-valuation
  - POST https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart

Schema:
  valuation_history(date TEXT PK, pe REAL, pb REAL, vnindex REAL, open REAL, high REAL,
                    low REAL, close REAL, ema50 REAL, volume REAL, accumulated_volume REAL,
                    accumulated_value REAL, updated_at TEXT)
  ema_breadth_history(trading_date TEXT PK, above_count INTEGER, total_count INTEGER,
                     above_percent REAL, updated_at TEXT)
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import random
import sqlite3
import sys
import time
import urllib.request
from typing import Any


_VALUATION_URL = (
    "https://trading.vietcap.com.vn/api/iq-insight-service/v1/market-watch/index-valuation"
)
_OHLC_URL = "https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart"
_BREADTH_URL = "https://iq.vietcap.com.vn/api/iq-insight-service/v1/market-watch/breadth"


def _headers(content_type: str | None = None) -> dict[str, str]:
    device_id = "".join(f"{random.randrange(256):02x}" for _ in range(12))
    h = {
        "accept": "application/json",
        "accept-language": "en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "origin": "https://trading.vietcap.com.vn",
        "referer": "https://trading.vietcap.com.vn/",
        "device-id": device_id,
    }
    if content_type:
        h["content-type"] = content_type
    return h


def _get_json(url: str, params: dict[str, str]) -> Any:
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    req = urllib.request.Request(f"{url}?{qs}", headers=_headers())
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def _post_json(url: str, payload: dict) -> Any:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=_headers("application/json"), method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def fetch_valuation_series(metric: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Returns (series, stats) where stats has average/plusOneSD/plusTwoSD/minusOneSD/minusTwoSD."""
    result = _get_json(_VALUATION_URL, {
        "type": metric,
        "comGroupCode": "VNINDEX",
        "timeFrame": "ALL",
    })
    data = (result or {}).get("data") or {}
    values = data.get("values") or []
    out = []
    for item in values:
        date = str(item.get("date") or "").strip()
        raw = item.get("value")
        if not date or raw is None:
            continue
        try:
            out.append({"date": date, "value": float(raw)})
        except (TypeError, ValueError):
            continue
    stats: dict[str, Any] = {}
    for key in ("average", "plusOneSD", "plusTwoSD", "minusOneSD", "minusTwoSD"):
        v = data.get(key)
        if v is not None:
            try:
                stats[key] = float(v)
            except (TypeError, ValueError):
                pass
    return out, stats


def fetch_vnindex_ohlc(count_back: int = 6000) -> list[dict[str, Any]]:
    payload = {
        "timeFrame": "ONE_DAY",
        "symbols": ["VNINDEX"],
        "to": int(time.time()),
        "countBack": count_back,
    }
    data = _post_json(_OHLC_URL, payload)
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
    out = []
    for i, ts in enumerate(timestamps):
        try:
            date_str = _dt.datetime.fromtimestamp(int(ts), tz=_dt.timezone.utc).strftime("%Y-%m-%d")
            close = float(closes[i]) if i < len(closes) and closes[i] is not None else None
            out.append({
                "date": date_str,
                "open": float(opens[i]) if i < len(opens) and opens[i] is not None else None,
                "high": float(highs[i]) if i < len(highs) and highs[i] is not None else None,
                "low": float(lows[i]) if i < len(lows) and lows[i] is not None else None,
                "close": close,
                # keep backward compatibility for existing merge logic
                "value": close,
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
            })
        except (TypeError, ValueError):
            continue
    return out


def fetch_ema50_breadth() -> list[dict[str, Any]]:
    result = _get_json(
        _BREADTH_URL,
        {
            "condition": "EMA50",
            "exchange": "HSX,HNX,UPCOM",
            "enNumberOfDays": "ALL",
        },
    )
    rows = (result or {}).get("data") or []
    out: list[dict[str, Any]] = []
    for item in rows:
        date = str(item.get("tradingDate") or "").strip()
        if not date:
            continue
        try:
            above = int(float(item.get("count") or 0))
            total = int(float(item.get("total") or 0))
            percent = float(item.get("percent")) if item.get("percent") is not None else None
        except (TypeError, ValueError):
            continue
        if total <= 0:
            continue
        out.append(
            {
                "trading_date": date,
                "above_count": above,
                "total_count": total,
                "above_percent": percent,
            }
        )
    return out


def attach_ema50(rows: list[dict[str, Any]], period: int = 50) -> None:
    """Mutates rows in-place and adds ema50 based on close/vnindex series."""
    if not rows:
        return

    multiplier = 2 / (period + 1)
    ema: float | None = None
    warmup: list[float] = []

    for row in rows:
        price_raw = row.get("close")
        if price_raw is None:
            price_raw = row.get("vnindex")
        if price_raw is None:
            row["ema50"] = None
            continue

        try:
            price = float(price_raw)
        except (TypeError, ValueError):
            row["ema50"] = None
            continue

        if ema is None:
            warmup.append(price)
            if len(warmup) < period:
                row["ema50"] = None
                continue
            ema = sum(warmup[-period:]) / period
        else:
            ema = (price - ema) * multiplier + ema

        row["ema50"] = float(ema)


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS valuation_history (
            date       TEXT PRIMARY KEY,
            pe         REAL,
            pb         REAL,
            vnindex    REAL,
            open       REAL,
            high       REAL,
            low        REAL,
            close      REAL,
            ema50      REAL,
            volume     REAL,
            accumulated_volume REAL,
            accumulated_value  REAL,
            updated_at TEXT
        );
        -- add volume column if missing (safe on existing DBs)
        CREATE TABLE IF NOT EXISTS _dummy_migration(x);
        DROP TABLE _dummy_migration;
        CREATE TABLE IF NOT EXISTS valuation_stats (
            metric        TEXT PRIMARY KEY,
            average       REAL,
            plus_one_sd   REAL,
            plus_two_sd   REAL,
            minus_one_sd  REAL,
            minus_two_sd  REAL,
            updated_at    TEXT
        );
        CREATE TABLE IF NOT EXISTS meta (
            k TEXT PRIMARY KEY,
            v TEXT
        );
        CREATE TABLE IF NOT EXISTS ema_breadth_history (
            trading_date TEXT PRIMARY KEY,
            above_count  INTEGER,
            total_count  INTEGER,
            above_percent REAL,
            updated_at   TEXT
        );
    """)
    # Migration-safe: add new columns when DB already exists.
    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(valuation_history)").fetchall()}
    if "open" not in existing_columns:
        conn.execute("ALTER TABLE valuation_history ADD COLUMN open REAL")
    if "high" not in existing_columns:
        conn.execute("ALTER TABLE valuation_history ADD COLUMN high REAL")
    if "low" not in existing_columns:
        conn.execute("ALTER TABLE valuation_history ADD COLUMN low REAL")
    if "close" not in existing_columns:
        conn.execute("ALTER TABLE valuation_history ADD COLUMN close REAL")
    if "ema50" not in existing_columns:
        conn.execute("ALTER TABLE valuation_history ADD COLUMN ema50 REAL")
    if "accumulated_volume" not in existing_columns:
        conn.execute("ALTER TABLE valuation_history ADD COLUMN accumulated_volume REAL")
    if "accumulated_value" not in existing_columns:
        conn.execute("ALTER TABLE valuation_history ADD COLUMN accumulated_value REAL")
    conn.commit()


def upsert_stats(conn: sqlite3.Connection, metric: str, stats: dict[str, Any]) -> None:
    if not stats:
        return
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO valuation_stats (metric, average, plus_one_sd, plus_two_sd, minus_one_sd, minus_two_sd, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(metric) DO UPDATE SET
            average      = excluded.average,
            plus_one_sd  = excluded.plus_one_sd,
            plus_two_sd  = excluded.plus_two_sd,
            minus_one_sd = excluded.minus_one_sd,
            minus_two_sd = excluded.minus_two_sd,
            updated_at   = excluded.updated_at
        """,
        (
            metric,
            stats.get("average"),
            stats.get("plusOneSD"),
            stats.get("plusTwoSD"),
            stats.get("minusOneSD"),
            stats.get("minusTwoSD"),
            now,
        ),
    )
    conn.commit()


def upsert(conn: sqlite3.Connection, rows: list[dict]) -> None:
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    conn.executemany(
        """
        INSERT INTO valuation_history (
            date, pe, pb, vnindex, open, high, low, close, ema50, volume, accumulated_volume, accumulated_value, updated_at
        )
        VALUES (
            :date, :pe, :pb, :vnindex, :open, :high, :low, :close, :ema50, :volume, :accumulated_volume, :accumulated_value, :now
        )
        ON CONFLICT(date) DO UPDATE SET
            pe         = COALESCE(excluded.pe,      valuation_history.pe),
            pb         = COALESCE(excluded.pb,      valuation_history.pb),
            vnindex    = COALESCE(excluded.vnindex,  valuation_history.vnindex),
            open       = COALESCE(excluded.open,     valuation_history.open),
            high       = COALESCE(excluded.high,     valuation_history.high),
            low        = COALESCE(excluded.low,      valuation_history.low),
            close      = COALESCE(excluded.close,    valuation_history.close),
            ema50      = COALESCE(excluded.ema50,    valuation_history.ema50),
            volume     = COALESCE(excluded.volume,   valuation_history.volume),
            accumulated_volume = COALESCE(excluded.accumulated_volume, valuation_history.accumulated_volume),
            accumulated_value  = COALESCE(excluded.accumulated_value,  valuation_history.accumulated_value),
            updated_at = excluded.updated_at
        """,
        [
            {
                "date": r["date"],
                "pe": r.get("pe"),
                "pb": r.get("pb"),
                "vnindex": r.get("vnindex"),
                "open": r.get("open"),
                "high": r.get("high"),
                "low": r.get("low"),
                "close": r.get("close"),
                "ema50": r.get("ema50"),
                "volume": r.get("volume"),
                "accumulated_volume": r.get("accumulated_volume"),
                "accumulated_value": r.get("accumulated_value"),
                "now": now,
            }
            for r in rows
        ],
    )
    conn.commit()


def upsert_ema_breadth(conn: sqlite3.Connection, rows: list[dict]) -> None:
    if not rows:
        return
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    conn.executemany(
        """
        INSERT INTO ema_breadth_history (
            trading_date, above_count, total_count, above_percent, updated_at
        )
        VALUES (
            :trading_date, :above_count, :total_count, :above_percent, :now
        )
        ON CONFLICT(trading_date) DO UPDATE SET
            above_count  = excluded.above_count,
            total_count  = excluded.total_count,
            above_percent = excluded.above_percent,
            updated_at   = excluded.updated_at
        """,
        [{**r, "now": now} for r in rows],
    )
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch VCI valuation data into SQLite")
    parser.add_argument("--db", default="fetch_sqlite/vci_valuation.sqlite")
    args = parser.parse_args()

    ts = lambda: _dt.datetime.now().strftime("%H:%M:%S")

    print(f"[{ts()}] Fetching PE TTM from VCI...")
    pe_series, pe_stats = fetch_valuation_series("pe")
    print(f"         {len(pe_series)} rows, stats: {pe_stats}")

    time.sleep(1)

    print(f"[{ts()}] Fetching PB TTM from VCI...")
    pb_series, pb_stats = fetch_valuation_series("pb")
    print(f"         {len(pb_series)} rows, stats: {pb_stats}")

    time.sleep(1)

    print(f"[{ts()}] Fetching VNINDEX OHLC from VCI...")
    vnindex_series = fetch_vnindex_ohlc()
    print(f"         {len(vnindex_series)} rows")

    time.sleep(1)

    print(f"[{ts()}] Fetching EMA50 market breadth from VCI...")
    breadth_series = fetch_ema50_breadth()
    print(f"         {len(breadth_series)} rows")

    # Merge all series by date
    by_date: dict[str, dict] = {}
    for item in pe_series:
        by_date.setdefault(item["date"], {})["pe"] = item["value"]
    for item in pb_series:
        by_date.setdefault(item["date"], {})["pb"] = item["value"]
    for item in vnindex_series:
        row = by_date.setdefault(item["date"], {})
        row["vnindex"] = item["value"]
        row["open"] = item.get("open")
        row["high"] = item.get("high")
        row["low"] = item.get("low")
        row["close"] = item.get("close")
        if item.get("volume") is not None:
            row["volume"] = item["volume"]
        if item.get("accumulated_volume") is not None:
            row["accumulated_volume"] = item["accumulated_volume"]
        if item.get("accumulated_value") is not None:
            row["accumulated_value"] = item["accumulated_value"]

    rows = [{"date": d, **v} for d, v in sorted(by_date.items())]
    attach_ema50(rows, period=50)
    print(f"[{ts()}] Merged: {len(rows)} rows total")

    conn = sqlite3.connect(args.db)
    init_db(conn)
    upsert(conn, rows)
    upsert_ema_breadth(conn, breadth_series)
    upsert_stats(conn, "pe", pe_stats)
    upsert_stats(conn, "pb", pb_stats)
    conn.execute(
        "INSERT OR REPLACE INTO meta(k,v) VALUES('last_run_utc', ?)",
        (_dt.datetime.now(_dt.timezone.utc).isoformat(),),
    )
    conn.commit()
    conn.close()
    print(f"[{ts()}] Done — {args.db}")


if __name__ == "__main__":
    main()
