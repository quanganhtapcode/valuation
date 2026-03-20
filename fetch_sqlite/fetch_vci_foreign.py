#!/usr/bin/env python3
"""Fetch VCI foreign trading data into SQLite.

Two tables in vci_foreign.sqlite:
  foreign_net_snapshot  — top buy/sell list  (refreshed every run, keyed by trading date)
  foreign_volume_minute — per-minute intraday volume/value (upserted each run)

Run every minute during trading hours (09:00–15:05 VN, Mon–Fri).
Cron example:
  */1 9-15 * * 1-5 cd /var/www/valuation && .venv/bin/python fetch_sqlite/fetch_vci_foreign.py >> fetch_sqlite/cron_foreign.log 2>&1
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import sqlite3
import sys
import time
import urllib.request
from typing import Any


_NET_URL   = "https://trading.vietcap.com.vn/api/market-watch/v3/ForeignNetValue/top"
_VOL_URL   = "https://trading.vietcap.com.vn/api/market-watch/v3/ForeignVolumeChart/getAll"
_DEFAULT_DB = "fetch_sqlite/vci_foreign.sqlite"


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def _headers() -> dict[str, str]:
    device_id = "".join(f"{random.randrange(256):02x}" for _ in range(12))
    return {
        "accept": "application/json",
        "accept-language": "en-US,en;q=0.9,vi-VN;q=0.8,vi;q=0.7",
        "content-type": "application/json",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "origin": "https://trading.vietcap.com.vn",
        "referer": "https://trading.vietcap.com.vn/",
        "device-id": device_id,
    }


def _post(url: str, payload: dict) -> Any:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=_headers(), method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def utc_now() -> str:
    return dt.datetime.now(tz=dt.timezone.utc).replace(microsecond=0).isoformat()


def vn_today() -> str:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).strftime("%Y-%m-%d")


def _vci_unix_window() -> tuple[int, int]:
    """Midnight UTC of current VN calendar date → now (matches browser behaviour)."""
    now_vn = dt.datetime.now(dt.timezone(dt.timedelta(hours=7)))
    midnight_utc = dt.datetime(now_vn.year, now_vn.month, now_vn.day, tzinfo=dt.timezone.utc)
    return int(midnight_utc.timestamp()), int(dt.datetime.now(tz=dt.timezone.utc).timestamp())


def _net_body() -> dict[str, object]:
    frm, to = _vci_unix_window()
    return {"from": frm, "to": to, "group": "ALL", "timeFrame": "ONE_DAY"}


def _volume_body() -> dict[str, object]:
    frm, to = _vci_unix_window()
    return {"from": frm, "to": to, "group": "ALL", "timeFrame": "ONE_MINUTE"}


# ─── SQLite setup ─────────────────────────────────────────────────────────────

def init_db(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS foreign_net_snapshot (
            trading_date  TEXT NOT NULL,
            raw_json      TEXT NOT NULL,
            fetched_at    TEXT NOT NULL,
            PRIMARY KEY (trading_date)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS foreign_volume_minute (
            trading_date  TEXT NOT NULL,
            minute        TEXT NOT NULL,   -- "HH:MM"
            buy_volume    REAL,
            sell_volume   REAL,
            buy_value     REAL,
            sell_value    REAL,
            fetched_at    TEXT NOT NULL,
            PRIMARY KEY (trading_date, minute)
        )
    """)
    conn.commit()
    return conn


# ─── Normalise helpers ────────────────────────────────────────────────────────

def _split_buy_sell(raw: Any) -> tuple[list[dict], list[dict]]:
    if not isinstance(raw, dict):
        return [], []
    # VCI v3 ForeignNetValue/top response: {"netBuy": [...], "netSell": [...]}
    net_buy  = raw.get("netBuy")  or []
    net_sell = raw.get("netSell") or []
    if net_buy or net_sell:
        return net_buy, net_sell
    # Legacy / wrapped formats
    data = raw.get("data") or raw
    if isinstance(data, dict):
        buy  = data.get("BuyList")  or data.get("buyList")  or []
        sell = data.get("SellList") or data.get("sellList") or []
        if buy or sell:
            return buy, sell
    items = data if isinstance(data, list) else []
    buy, sell = [], []
    for item in items:
        net = float(item.get("net") or item.get("netBuyValue") or item.get("netValue") or 0)
        (buy if net >= 0 else sell).append(item)
    return buy, sell


_VN_TZ = dt.timezone(dt.timedelta(hours=7))


def _parse_minute(raw_point: dict) -> str | None:
    """Extract HH:MM VN from a VCI volume point.
    VCI ForeignVolumeChart/getAll uses 'truncTime' (unix seconds as string).
    """
    t = (raw_point.get("truncTime") or raw_point.get("time")
         or raw_point.get("t") or raw_point.get("timestamp") or "")
    if t:
        try:
            ts = float(t)
            # unix seconds → VN local time
            d = dt.datetime.fromtimestamp(ts, tz=_VN_TZ)
            return f"{d.hour:02d}:{d.minute:02d}"
        except (ValueError, TypeError, OSError):
            pass
    s = str(t)
    if ":" in s:
        return s[:5]
    return None


# ─── Fetch & store ────────────────────────────────────────────────────────────

def fetch_net(conn: sqlite3.Connection, trading_date: str) -> bool:
    try:
        raw = _post(_NET_URL, _net_body())
    except Exception as exc:
        print(f"[foreign_net] fetch error: {exc}", file=sys.stderr)
        return False

    buy, sell = _split_buy_sell(raw)
    if not buy and not sell:
        print("[foreign_net] empty response — market may be closed", file=sys.stderr)
        return False

    payload = json.dumps({"buyList": buy, "sellList": sell}, ensure_ascii=False)
    conn.execute(
        "INSERT OR REPLACE INTO foreign_net_snapshot (trading_date, raw_json, fetched_at) VALUES (?,?,?)",
        (trading_date, payload, utc_now()),
    )
    conn.commit()
    print(f"[foreign_net] stored {len(buy)} buy + {len(sell)} sell items for {trading_date}")
    return True


def fetch_volume(conn: sqlite3.Connection, trading_date: str) -> bool:
    try:
        raw = _post(_VOL_URL, _volume_body())
    except Exception as exc:
        print(f"[foreign_vol] fetch error: {exc}", file=sys.stderr)
        return False

    # VCI ForeignVolumeChart/getAll returns a raw list (not wrapped)
    if isinstance(raw, list):
        points = raw
    else:
        points = (raw or {}).get("data") or (raw or {}).get("Data") or []
    if not isinstance(points, list) or not points:
        print("[foreign_vol] empty response", file=sys.stderr)
        return False

    now = utc_now()
    rows = []
    for p in points:
        minute = _parse_minute(p)
        if not minute or not ("09:00" <= minute <= "15:05"):
            continue
        rows.append((
            trading_date,
            minute,
            float(p.get("buyVolume")  or p.get("foreignBuyVolume")  or p.get("fBuyVol")  or 0),
            float(p.get("sellVolume") or p.get("foreignSellVolume") or p.get("fSellVol") or 0),
            float(p.get("buyValue")   or p.get("foreignBuyValue")   or p.get("fBuyVal")  or 0),
            float(p.get("sellValue")  or p.get("foreignSellValue")  or p.get("fSellVal") or 0),
            now,
        ))

    if not rows:
        print("[foreign_vol] no session-hours points found", file=sys.stderr)
        return False

    conn.executemany(
        """INSERT OR REPLACE INTO foreign_volume_minute
           (trading_date, minute, buy_volume, sell_volume, buy_value, sell_value, fetched_at)
           VALUES (?,?,?,?,?,?,?)""",
        rows,
    )
    conn.commit()
    print(f"[foreign_vol] upserted {len(rows)} minute rows for {trading_date}")
    return True


# ─── Prune old data (keep last 30 trading days) ───────────────────────────────

def prune(conn: sqlite3.Connection, keep_days: int = 30) -> None:
    cutoff = (
        dt.datetime.now(dt.timezone(dt.timedelta(hours=7))) - dt.timedelta(days=keep_days)
    ).strftime("%Y-%m-%d")
    conn.execute("DELETE FROM foreign_net_snapshot  WHERE trading_date < ?", (cutoff,))
    conn.execute("DELETE FROM foreign_volume_minute WHERE trading_date < ?", (cutoff,))
    conn.commit()


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch VCI foreign data into SQLite")
    parser.add_argument("--db", default=_DEFAULT_DB)
    parser.add_argument("--date", default=None, help="Override trading date (YYYY-MM-DD)")
    args = parser.parse_args()

    trading_date = args.date or vn_today()
    conn = init_db(args.db)

    ok_net = fetch_net(conn, trading_date)
    ok_vol = fetch_volume(conn, trading_date)
    prune(conn)
    conn.close()

    if not ok_net and not ok_vol:
        sys.exit(1)


if __name__ == "__main__":
    main()
