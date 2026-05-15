#!/usr/bin/env python3
"""Fetch VCI v2 financial-data (actuals + analyst forecasts) into SQLite.

Requires a Vietcap bearer token obtained via Telegram (same flow as update_excel_data.py).

Usage:
    python fetch_sqlite/fetch_vci_financial_data.py
    python fetch_sqlite/fetch_vci_financial_data.py --ticker ACB VCB
    python fetch_sqlite/fetch_vci_financial_data.py --dry-run
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from backend.db_path import resolve_valuation_cache_db_path, resolve_vci_screening_db_path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

API_URL = "https://iq.vietcap.com.vn/api/iq-insight-service/v2/company/{ticker}/financial-data"
TELEGRAM_ENV_FILE = str(ROOT / ".telegram_uptime.env")
TOKEN_WAIT_MINUTES = int(os.getenv("EXCEL_TOKEN_WAIT_MINUTES", "30"))
MAX_WORKERS = 8
REQUEST_TIMEOUT = 20
RATE_LIMIT_DELAY = 0.15  # seconds between requests

DDL = """
CREATE TABLE IF NOT EXISTS vci_financial_data (
    ticker        TEXT PRIMARY KEY,
    raw_json      TEXT,
    target_price  REAL,
    recommendation TEXT,
    fetched_at    TEXT
);

CREATE TABLE IF NOT EXISTS vci_financial_data_years (
    ticker         TEXT NOT NULL,
    year           INTEGER NOT NULL,
    is_forecast    INTEGER NOT NULL DEFAULT 0,
    revenue_growth REAL,
    profit_growth  REAL,
    pe             REAL,
    pb             REAL,
    roe            REAL,
    eps            REAL,
    dividend_yield REAL,
    fetched_at     TEXT,
    PRIMARY KEY (ticker, year)
);
"""

# ── Telegram helpers (mirrors automation/update_excel_data.py) ────────────

def _get_telegram_config() -> tuple[str | None, str | None]:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if bot_token and chat_id:
        return bot_token, chat_id
    if os.path.exists(TELEGRAM_ENV_FILE):
        env = dotenv_values(TELEGRAM_ENV_FILE)
        bot_token = bot_token or env.get("TELEGRAM_BOT_TOKEN")
        chat_id = chat_id or env.get("TELEGRAM_CHAT_ID")
    return bot_token, chat_id


def _send_telegram(bot_token: str, chat_id: str, text: str, reply_markup: dict | None = None) -> dict:
    payload: dict = {"chat_id": chat_id, "text": text}
    if reply_markup:
        payload["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
    r = requests.post(f"https://api.telegram.org/bot{bot_token}/sendMessage", data=payload, timeout=20)
    r.raise_for_status()
    return r.json().get("result") or {}


def _answer_callback(bot_token: str, cb_id: str) -> None:
    requests.post(f"https://api.telegram.org/bot{bot_token}/answerCallbackQuery",
                  data={"callback_query_id": cb_id, "text": "✅ Dán token vào chat"}, timeout=10)


def _extract_token(text: str) -> str | None:
    if not text:
        return None
    s = text.strip()
    for pattern in [r"(?i)\bbearer\s+([A-Za-z0-9\-._~+/=]+)",
                    r"(?i)^/token\s+([A-Za-z0-9\-._~+/=]+)$"]:
        m = re.search(pattern, s)
        if m and len(m.group(1)) >= 80:
            return m.group(1).strip()
    m = re.search(r"\b([A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,})\b", s.replace("\n", " "))
    if m:
        return m.group(1).strip()
    if len(s) >= 80 and " " not in s:
        return s
    return None


def _wait_for_token(bot_token: str, chat_id: str, offset: int, sent_after: int) -> tuple[str | None, int]:
    deadline = time.time() + TOKEN_WAIT_MINUTES * 60
    prompted = False
    while time.time() < deadline:
        resp = requests.get(f"https://api.telegram.org/bot{bot_token}/getUpdates",
                            params={"timeout": 30, "offset": offset}, timeout=35)
        resp.raise_for_status()
        updates = resp.json().get("result", [])
        for update in updates:
            uid = update.get("update_id")
            if isinstance(uid, int):
                offset = max(offset, uid + 1)
            cb = update.get("callback_query")
            if isinstance(cb, dict) and not prompted:
                cb_chat = str(((cb.get("message") or {}).get("chat") or {}).get("id", ""))
                if cb_chat == str(chat_id) and cb.get("data") == "send_token":
                    _answer_callback(bot_token, str(cb.get("id", "")))
                    _send_telegram(bot_token, chat_id, "👇 Dán Bearer token VCI vào đây:",
                                   {"force_reply": True, "input_field_placeholder": "eyJ0eXAiOiJKV1QiLCJhbGciOi..."})
                    prompted = True
                    continue
            msg = update.get("message") or update.get("edited_message")
            if not isinstance(msg, dict):
                continue
            if str((msg.get("chat") or {}).get("id", "")) != str(chat_id):
                continue
            if int(msg.get("date", 0) or 0) < sent_after:
                continue
            token = _extract_token(str(msg.get("text") or ""))
            if token:
                return token, offset
    return None, offset


def obtain_token() -> str | None:
    env_token = (os.getenv("VCI_BEARER_TOKEN") or "").strip()
    if env_token:
        return env_token
    bot_token, chat_id = _get_telegram_config()
    if not bot_token or not chat_id:
        log.error("Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID")
        return None
    sent_at = int(time.time())
    _send_telegram(bot_token, chat_id,
                   f"🔐 *VCI Financial Data Fetch*\n\nCần Bearer token để tải dữ liệu tài chính / forecast.\n⏳ Chờ tối đa {TOKEN_WAIT_MINUTES} phút.",
                   {"inline_keyboard": [[{"text": "🔑 Gửi Bearer Token", "callback_data": "send_token"}]]})
    log.info("Sent Telegram token request, waiting...")
    token, _ = _wait_for_token(bot_token, chat_id, 0, sent_at)
    if token:
        log.info("Token received via Telegram")
    else:
        log.error("No token received within timeout")
    return token


# ── API fetch ─────────────────────────────────────────────────────────────

def _headers(bearer: str) -> dict[str, str]:
    return {
        "accept": "application/json",
        "accept-encoding": "gzip",
        "authorization": f"Bearer {bearer}",
        "origin": "https://trading.vietcap.com.vn",
        "referer": "https://trading.vietcap.com.vn/",
        "sec-fetch-site": "same-site",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }


def fetch_one(ticker: str, bearer: str) -> dict | None:
    url = API_URL.format(ticker=ticker.upper())
    req = urllib.request.Request(url, headers=_headers(bearer))
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            raw = resp.read()
            if resp.headers.get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and parsed.get("successful") is False:
                status = parsed.get("status", 0)
                exc = parsed.get("exception", "")
                if status == 401 or "expired" in str(exc).lower() or "token" in str(exc).lower():
                    raise RuntimeError(f"Token expired (401): {exc}")
                log.warning(f"[{ticker}] API error status={status}: {exc}")
                return None
            return parsed
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise RuntimeError(f"Token expired (401)")
        if e.code == 403:
            log.warning(f"[{ticker}] HTTP 403 (WAF block or token rejected at network level)")
            return None
        log.warning(f"[{ticker}] HTTP {e.code}")
        return None
    except RuntimeError:
        raise
    except Exception as e:
        log.warning(f"[{ticker}] {e}")
        return None


# ── Response parser ───────────────────────────────────────────────────────

def _float(v) -> float | None:
    try:
        f = float(v)
        return f if f == f else None  # exclude NaN
    except (TypeError, ValueError):
        return None


def _coerce_pct(v) -> float | None:
    """Convert VCI percentage value: if abs > 10 assume already % else multiply by 100."""
    f = _float(v)
    if f is None:
        return None
    if abs(f) <= 10:
        return round(f * 100, 2)
    return round(f, 2)


def parse_response(raw: dict, ticker: str, fetched_at: str) -> tuple[dict, list[dict]]:
    """Parse VCI v2 financial-data API response into (header_row, year_rows).

    The API returns a wide format: each metric is a dict keyed by year string
    e.g. {"2023": 7.37, "2024": 7.07, "TTM": 7.19, "2026F": 6.19, "2027F": 5.36}
    Years ending in "F" are analyst forecasts; "TTM" is skipped.
    """
    data_block = raw.get("data") or {}
    if not isinstance(data_block, dict):
        data_block = {}

    target_price = None
    for src in (raw, data_block):
        for k in ("targetPrice", "target_price", "priceTarget"):
            v = _float(src.get(k))
            if v:
                target_price = v
                break
        if target_price:
            break

    recommendation = None
    for src in (raw, data_block):
        for k in ("recommendation", "rating", "action"):
            v = src.get(k)
            if v and isinstance(v, str):
                recommendation = v.upper()
                break
        if recommendation:
            break

    header = {
        "ticker": ticker,
        "raw_json": json.dumps(raw, ensure_ascii=False),
        "target_price": target_price,
        "recommendation": recommendation,
        "fetched_at": fetched_at,
    }

    # Collect all year keys from the pe metric dict (skip TTM)
    all_year_keys: list[str] = []
    for metric in ("pe", "revenue", "NPATMI", "eps", "roe", "pb"):
        m = data_block.get(metric) or {}
        if m:
            all_year_keys = [k for k in m if k != "TTM"]
            break

    def get_metric(metric_name: str, year_key: str) -> float | None:
        m = data_block.get(metric_name) or {}
        return _float(m.get(year_key))

    year_rows = []
    for yk in all_year_keys:
        is_forecast = 1 if yk.endswith("F") else 0
        year_str = yk.rstrip("F")
        try:
            year = int(year_str)
        except (TypeError, ValueError):
            continue

        rg_raw = get_metric("revenueGrowth", yk)
        pg_raw = (get_metric("NPATMIGrowth", yk)
                  or get_metric("npatmigrowth", yk)
                  or get_metric("profitGrowth", yk))
        roe_raw = get_metric("roe", yk)
        div_raw = get_metric("dividendYield", yk)

        year_rows.append({
            "ticker": ticker,
            "year": year,
            "is_forecast": is_forecast,
            "revenue_growth": _coerce_pct(rg_raw),
            "profit_growth": _coerce_pct(pg_raw),
            "pe": get_metric("pe", yk),
            "pb": get_metric("pb", yk),
            "roe": _coerce_pct(roe_raw),
            "eps": get_metric("eps", yk),
            "dividend_yield": _coerce_pct(div_raw),
            "fetched_at": fetched_at,
        })

    year_rows.sort(key=lambda r: r["year"])
    return header, year_rows


# ── SQLite storage ────────────────────────────────────────────────────────

def ensure_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(DDL)
    conn.commit()


def upsert(conn: sqlite3.Connection, header: dict, year_rows: list[dict]) -> None:
    conn.execute("""
        INSERT OR REPLACE INTO vci_financial_data
            (ticker, raw_json, target_price, recommendation, fetched_at)
        VALUES (:ticker, :raw_json, :target_price, :recommendation, :fetched_at)
    """, header)
    conn.executemany("""
        INSERT OR REPLACE INTO vci_financial_data_years
            (ticker, year, is_forecast, revenue_growth, profit_growth,
             pe, pb, roe, eps, dividend_yield, fetched_at)
        VALUES (:ticker, :year, :is_forecast, :revenue_growth, :profit_growth,
                :pe, :pb, :roe, :eps, :dividend_yield, :fetched_at)
    """, year_rows)
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────

def get_tickers(override: list[str] | None) -> list[str]:
    scr_path = resolve_vci_screening_db_path()
    conn = sqlite3.connect(f"file:{scr_path}?mode=ro", uri=True)
    if override:
        rows = conn.execute(
            f"SELECT ticker FROM screening_data WHERE ticker IN ({','.join('?'*len(override))}) AND exchange IN ('HSX','HNX')",
            override,
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT ticker FROM screening_data WHERE exchange IN ('HSX','HNX') ORDER BY ticker"
        ).fetchall()
    conn.close()
    return [r[0] for r in rows]


def run(tickers_override: list[str] | None, limit: int, dry_run: bool) -> None:
    bearer = obtain_token()
    if not bearer:
        sys.exit(1)

    tickers = get_tickers(tickers_override)
    if limit:
        tickers = tickers[:limit]
    log.info(f"Processing {len(tickers)} tickers")

    if dry_run:
        log.info("DRY RUN — would fetch %d tickers", len(tickers))
        return

    cache_path = resolve_valuation_cache_db_path()
    cache = sqlite3.connect(cache_path)
    ensure_tables(cache)

    fetched_at = datetime.now(timezone.utc).isoformat()
    done = errors = token_dead = 0

    for i, ticker in enumerate(tickers):
        if token_dead:
            break
        try:
            raw = fetch_one(ticker, bearer)
            if raw is None:
                errors += 1
                continue
            header, year_rows = parse_response(raw, ticker, fetched_at)
            upsert(cache, header, year_rows)
            done += 1
            if (i + 1) % 100 == 0:
                log.info(f"  Progress: {i+1}/{len(tickers)} done={done} errors={errors}")
        except RuntimeError as e:
            if "401" in str(e):
                log.error("Token expired, stopping")
                token_dead = 1
            else:
                log.error(f"[{ticker}] {e}")
                errors += 1
        except Exception as e:
            log.error(f"[{ticker}] {e}")
            errors += 1
        time.sleep(RATE_LIMIT_DELAY)

    cache.close()
    log.info(f"Done: {done} fetched, {errors} errors out of {len(tickers)} tickers")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch VCI v2 financial-data (bearer token required)")
    parser.add_argument("--ticker", nargs="+", help="Specific tickers")
    parser.add_argument("--limit", type=int, default=0, help="Max tickers")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.ticker, args.limit, args.dry_run)
