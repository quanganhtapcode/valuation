"""
Fetch beta values from FireAnt /symbols/{ticker}/fundamental for all stocks.
Stores results in fireant_macro.sqlite → beta_cache table.

Run:
    python fetch_sqlite/fetch_fireant_beta.py --db fetch_sqlite/fireant_macro.sqlite
    python fetch_sqlite/fetch_fireant_beta.py --db fetch_sqlite/fireant_macro.sqlite --workers 5
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

_DB_PATH = os.path.join(os.path.dirname(__file__), "fireant_macro.sqlite")
_SCREENING_DB = os.path.join(os.path.dirname(__file__), "vci_screening.sqlite")

_BEARER = (
    "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6IkdYdExONzViZlZQakdvNERWdjV4QkRI"
    "THpnSSIsImtpZCI6IkdYdExONzViZlZQakdvNERWdjV4QkRITHpnSSJ9.eyJpc3MiOiJodHRwczov"
    "L2FjY291bnRzLmZpcmVhbnQudm4iLCJhdWQiOiJodHRwczovL2FjY291bnRzLmZpcmVhbnQudm4v"
    "cmVzb3VyY2VzIiwiZXhwIjoxODg5NjIyNTMwLCJuYmYiOjE1ODk2MjI1MzAsImNsaWVudF9pZCI6"
    "ImZpcmVhbnQudHJhZGVzdGF0aW9uIiwic2NvcGUiOlsiYWNhZGVteS1yZWFkIiwiYWNhZGVteS13"
    "cml0ZSIsImFjY291bnRzLXJlYWQiLCJhY2NvdW50cy13cml0ZSIsImJsb2ctcmVhZCIsImNvbXBh"
    "bmllcy1yZWFkIiwiZmluYW5jZS1yZWFkIiwiaW5kaXZpZHVhbHMtcmVhZCIsImludmVzdG9wZWRp"
    "YS1yZWFkIiwib3JkZXJzLXJlYWQiLCJvcmRlcnMtd3JpdGUiLCJwb3N0cy1yZWFkIiwicG9zdHMt"
    "d3JpdGUiLCJzZWFyY2giLCJzeW1ib2xzLXJlYWQiLCJ1c2VyLWRhdGEtcmVhZCIsInVzZXItZGF0"
    "YS13cml0ZSIsInVzZXJzLXJlYWQiXSwianRpIjoiMjYxYTZhYWQ2MTQ5Njk1ZmJiYzcwODM5MjM0"
    "Njc1NWQifQ.dA5-HVzWv-BRfEiAd24uNBiBxASO-PAyWeWESovZm_hj4aXMAZA1-bWNZeXt88dqo"
    "go18AwpDQ-h6gefLPdZSFrG5umC1dVWaeYvUnGm62g4XS29fj6p01dhKNNqrsu5KrhnhdnKYVv9Vd"
    "mbmqDfWR8wDgglk5cJFqalzq6dJWJInFQEPmUs9BW_Zs8tQDn-i5r4tYq2U8vCdqptXoM7YgPllX"
    "aPVDeccC9QNu2Xlp9WUvoROzoQXg25lFub1IYkTrM66gJ6t9fJRZToewCt495WNEOQFa_rwLCZ1Qw"
    "zvL0iYkONHS_jZ0BOhBCdW9dWSawD6iF1SIQaFROvMDH1rg"
)
_HEADERS = {
    "authorization": f"Bearer {_BEARER}",
    "origin": "https://fireant.vn",
    "referer": "https://fireant.vn/",
    "accept": "application/json",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS beta_cache (
    symbol     TEXT PRIMARY KEY,
    beta       REAL NOT NULL,
    fetched_at TEXT NOT NULL
);
"""


def _ensure_schema(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def _get_all_tickers(screening_db: str) -> list[str]:
    conn = sqlite3.connect(screening_db)
    rows = conn.execute("SELECT ticker FROM screening_data ORDER BY ticker").fetchall()
    conn.close()
    return [r[0] for r in rows if r[0]]


def _fetch_beta(ticker: str, retries: int = 3, delay: float = 1.0) -> tuple[str, float | None]:
    url = f"https://restv2.fireant.vn/symbols/{ticker}/fundamental"
    req = urllib.request.Request(url, headers=_HEADERS)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read())
            beta = data.get("beta")
            if beta is not None and isinstance(beta, (int, float)) and 0 < float(beta) < 10:
                return ticker, float(round(beta, 4))
            return ticker, None
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(delay * (attempt + 1))
            else:
                logger.debug("Failed %s: %s", ticker, exc)
    return ticker, None


def run(db_path: str, screening_db: str, workers: int = 8, delay: float = 0.1) -> None:
    _ensure_schema(db_path)
    tickers = _get_all_tickers(screening_db)
    logger.info("Fetching beta for %d tickers (workers=%d)", len(tickers), workers)

    fetched_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    results: list[tuple[str, float]] = []
    failed = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_beta, t): t for t in tickers}
        for i, fut in enumerate(as_completed(futures), 1):
            ticker, beta = fut.result()
            if beta is not None:
                results.append((ticker, beta))
            else:
                failed += 1
            if i % 100 == 0:
                logger.info("Progress: %d/%d (ok=%d, fail=%d)", i, len(tickers), len(results), failed)
            time.sleep(delay)

    if results:
        conn = sqlite3.connect(db_path)
        conn.executemany(
            "INSERT OR REPLACE INTO beta_cache (symbol, beta, fetched_at) VALUES (?,?,?)",
            [(t, b, fetched_at) for t, b in results],
        )
        conn.commit()
        conn.close()

    logger.info("Done — saved %d betas, %d failed/missing", len(results), failed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch FireAnt beta for all stocks")
    parser.add_argument("--db", default=_DB_PATH)
    parser.add_argument("--screening-db", default=_SCREENING_DB)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--delay", type=float, default=0.1)
    args = parser.parse_args()
    run(args.db, args.screening_db, args.workers, args.delay)
