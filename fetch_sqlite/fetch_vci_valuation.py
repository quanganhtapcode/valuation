#!/usr/bin/env python3
"""Fetch VCI index valuation (PE TTM, PB TTM) and VNINDEX OHLC into SQLite.

Run daily after market close (e.g. 18:30) to keep vci_valuation.sqlite fresh.
Schema:
  valuation_history(date TEXT PK, pe REAL, pb REAL, vnindex REAL, updated_at TEXT)
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
    closes = item.get("c") or []
    out = []
    for ts, close in zip(timestamps, closes):
        try:
            date_str = _dt.datetime.fromtimestamp(int(ts), tz=_dt.timezone.utc).strftime("%Y-%m-%d")
            out.append({"date": date_str, "value": float(close)})
        except (TypeError, ValueError):
            continue
    return out


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS valuation_history (
            date       TEXT PRIMARY KEY,
            pe         REAL,
            pb         REAL,
            vnindex    REAL,
            updated_at TEXT
        );
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
    """)
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
        INSERT INTO valuation_history (date, pe, pb, vnindex, updated_at)
        VALUES (:date, :pe, :pb, :vnindex, :now)
        ON CONFLICT(date) DO UPDATE SET
            pe         = COALESCE(excluded.pe,      valuation_history.pe),
            pb         = COALESCE(excluded.pb,      valuation_history.pb),
            vnindex    = COALESCE(excluded.vnindex,  valuation_history.vnindex),
            updated_at = excluded.updated_at
        """,
        [
            {
                "date": r["date"],
                "pe": r.get("pe"),
                "pb": r.get("pb"),
                "vnindex": r.get("vnindex"),
                "now": now,
            }
            for r in rows
        ],
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

    # Merge all series by date
    by_date: dict[str, dict] = {}
    for item in pe_series:
        by_date.setdefault(item["date"], {})["pe"] = item["value"]
    for item in pb_series:
        by_date.setdefault(item["date"], {})["pb"] = item["value"]
    for item in vnindex_series:
        by_date.setdefault(item["date"], {})["vnindex"] = item["value"]

    rows = [{"date": d, **v} for d, v in sorted(by_date.items())]
    print(f"[{ts()}] Merged: {len(rows)} rows total")

    conn = sqlite3.connect(args.db)
    init_db(conn)
    upsert(conn, rows)
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
