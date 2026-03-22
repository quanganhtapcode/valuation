"""
Batch-fetch VCI IQ news + events for all symbols → fetch_sqlite/vci_news_events.sqlite

Run:
    python -m backend.updater.batch_news            # full refresh
    python -m backend.updater.batch_news --incremental  # only symbols not fetched today
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

VCI_IQ_BASE = "https://iq.vietcap.com.vn/api/iq-insight-service/v1"
VCI_HEADERS = {
    "accept": "application/json",
    "accept-language": "en-US,en;q=0.9",
    "origin": "https://trading.vietcap.com.vn",
    "referer": "https://trading.vietcap.com.vn/",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
}

TABS: dict[str, dict] = {
    "news":     {"path": "news",   "extra": {"languageId": "1"}},
    "dividend": {"path": "events", "extra": {"eventCode": "DIV,ISS"}},
    "insider":  {"path": "events", "extra": {"eventCode": "DDIND,DDINS,DDRP"}},
    "agm":      {"path": "events", "extra": {"eventCode": "AGME,AGMR,EGME"}},
    "other":    {"path": "events", "extra": {"eventCode": "AIS,MA,MOVE,NLIS,OTHE,RETU,SUSP"}},
}

MAX_WORKERS = 20   # concurrent HTTP requests
PAGE_SIZE   = 50   # items per request

# ── DB path ───────────────────────────────────────────────────────────────────

def _db_path() -> str:
    env = os.environ.get("VCI_NEWS_EVENTS_DB_PATH")
    if env:
        return env
    candidates = [
        Path(__file__).parent.parent.parent / "fetch_sqlite" / "vci_news_events.sqlite",
        Path("/var/www/valuation/fetch_sqlite/vci_news_events.sqlite"),
    ]
    for c in candidates:
        if c.parent.exists():
            return str(c)
    return str(candidates[0])


def _init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS items (
            id          TEXT NOT NULL,
            symbol      TEXT NOT NULL,
            tab         TEXT NOT NULL,
            public_date TEXT,
            title       TEXT,
            raw_json    TEXT NOT NULL,
            fetched_at  TEXT NOT NULL,
            PRIMARY KEY (id, tab)
        );
        CREATE INDEX IF NOT EXISTS idx_items_symbol_tab
            ON items(symbol, tab, public_date DESC);

        CREATE TABLE IF NOT EXISTS fetch_meta (
            symbol       TEXT NOT NULL,
            tab          TEXT NOT NULL,
            last_fetched TEXT,
            item_count   INTEGER DEFAULT 0,
            PRIMARY KEY (symbol, tab)
        );
    """)
    conn.commit()


# ── Fetch ─────────────────────────────────────────────────────────────────────

def _fetch_tab(symbol: str, tab: str) -> list[dict]:
    cfg = TABS[tab]
    today = date.today()
    params = {
        "ticker": symbol,
        "fromDate": "20100101",
        "toDate":   f"{today.year + 1}{today.month:02d}{today.day:02d}",
        "page": "0",
        "size": str(PAGE_SIZE),
        **cfg["extra"],
    }
    resp = requests.get(
        f"{VCI_IQ_BASE}/{cfg['path']}",
        params=params,
        headers=VCI_HEADERS,
        timeout=12,
    )
    resp.raise_for_status()
    return (resp.json().get("data") or {}).get("content") or []


def _row_from_item(item: dict, symbol: str, tab: str, now: str) -> tuple:
    item_id = item.get("id") or item.get("newsId") or ""
    if not item_id:
        return None
    pub = (
        item.get("publicDate")
        or item.get("displayDate1")
        or item.get("displayDate2")
        or ""
    )
    if pub:
        pub = pub[:10]  # keep only date part
    title = (
        item.get("newsTitle")
        or item.get("eventTitleEn")
        or item.get("eventTitleVi")
        or item.get("eventNameEn")
        or ""
    )
    return (str(item_id), symbol, tab, pub, title, json.dumps(item, ensure_ascii=False), now)


# ── Worker ────────────────────────────────────────────────────────────────────

def _work(symbol: str, tab: str, incremental_cutoff: str | None) -> tuple[str, str, int, str | None]:
    """Returns (symbol, tab, count, error_message|None)."""
    try:
        items = _fetch_tab(symbol, tab)
        return (symbol, tab, len(items), None, items)
    except Exception as exc:
        return (symbol, tab, 0, str(exc), [])


# ── Main ──────────────────────────────────────────────────────────────────────

def run(incremental: bool = False) -> None:
    db_path = _db_path()
    logger.info("DB: %s", db_path)

    # Load symbols from vci_screening
    screen_db = str(Path(db_path).parent / "vci_screening.sqlite")
    if not Path(screen_db).exists():
        logger.error("vci_screening.sqlite not found at %s", screen_db)
        sys.exit(1)

    with sqlite3.connect(screen_db) as sc:
        symbols = [r[0] for r in sc.execute("SELECT DISTINCT ticker FROM screening_data WHERE ticker IS NOT NULL AND ticker != ''").fetchall()]
    logger.info("Symbols: %d", len(symbols))

    with sqlite3.connect(db_path) as conn:
        _init_db(conn)

        already_fetched: set[tuple[str, str]] = set()
        if incremental:
            today_str = date.today().isoformat()
            rows = conn.execute(
                "SELECT symbol, tab FROM fetch_meta WHERE last_fetched >= ?", (today_str,)
            ).fetchall()
            already_fetched = {(r[0], r[1]) for r in rows}
            logger.info("Skipping %d already-fetched (symbol, tab) pairs", len(already_fetched))

        # Build work queue
        tasks = [
            (sym, tab)
            for sym in symbols
            for tab in TABS
            if (sym, tab) not in already_fetched
        ]
        logger.info("Tasks to run: %d", len(tasks))

        done = 0
        errors = 0
        now = datetime.utcnow().isoformat()

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futures = {pool.submit(_work, sym, tab, None): (sym, tab) for sym, tab in tasks}
            for future in as_completed(futures):
                symbol, tab, count, err, items = future.result()
                done += 1

                if err:
                    errors += 1
                    if done % 100 == 0 or errors <= 5:
                        logger.warning("ERR %s/%s: %s", symbol, tab, err)
                    conn.execute(
                        "INSERT OR REPLACE INTO fetch_meta VALUES (?,?,?,?)",
                        (symbol, tab, None, 0),
                    )
                else:
                    rows = [_row_from_item(it, symbol, tab, now) for it in items]
                    rows = [r for r in rows if r]
                    if rows:
                        conn.executemany(
                            "INSERT OR REPLACE INTO items VALUES (?,?,?,?,?,?,?)", rows
                        )
                    conn.execute(
                        "INSERT OR REPLACE INTO fetch_meta VALUES (?,?,?,?)",
                        (symbol, tab, date.today().isoformat(), len(rows)),
                    )

                if done % 500 == 0:
                    conn.commit()
                    logger.info("Progress: %d/%d (errors: %d)", done, len(tasks), errors)

        conn.commit()

    logger.info("Done. Tasks: %d, errors: %d", done, errors)

    # Report DB size
    with sqlite3.connect(db_path) as conn:
        total = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        symbols_done = conn.execute("SELECT COUNT(DISTINCT symbol) FROM items").fetchone()[0]
        logger.info("DB: %d items across %d symbols", total, symbols_done)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--incremental", action="store_true", help="Skip symbols fetched today")
    args = ap.parse_args()
    run(incremental=args.incremental)
